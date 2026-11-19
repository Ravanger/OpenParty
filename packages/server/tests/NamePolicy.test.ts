import type { FilterLevel, FilterResult, TextFilter } from "@openparty/content/filter";
import { defineGame } from "@openparty/core";
import { type BaseGameState, PlayerSchema } from "@openparty/shared/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NamePolicy, type NamePolicyDeps } from "../src/rooms/NamePolicy.js";
import { PlainGame } from "./fixtures/buzzer.js";

/** A game whose filter level is a host-picked option: the policy must read it live. */
const LevelGame = defineGame<BaseGameState, Record<string, never>, { level: FilterLevel }>({
  name: "Level",
  version: "1",
  minPlayers: 1,
  maxPlayers: 2,
  startPhase: "Play",
  options: z.object({ level: z.enum(["off", "moderate", "strict"]).default("moderate") }),
  filterLevel: (options) => options.level,
  createPrivateState: () => ({}),
  phases: { Play: {} },
});

/** A stand-in filter: anything containing "bad" is refused at every level but off. */
const badFilter: TextFilter = {
  check: (text, level): FilterResult =>
    text.includes("bad") && level !== "off"
      ? { ok: false, reason: "contains inappropriate language" }
      : { ok: true },
};

const makePolicy = (overrides: Partial<NamePolicyDeps> = {}): NamePolicy =>
  new NamePolicy({
    definition: LevelGame,
    textFilter: badFilter,
    options: () => ({ level: "moderate" }),
    players: () => [],
    seatOf: () => undefined,
    phase: () => "Play",
    limited: () => true,
    setNameBucket: { rate: 2, burst: 2 },
    rosterChanged: () => {},
    ...overrides,
  });

const seatOf = (id: string, name: string): PlayerSchema => {
  const seat = new PlayerSchema();
  seat.id = id;
  seat.name = name;
  return seat;
};

describe("NamePolicy", () => {
  it("reads the filter level from the live room options", () => {
    const options: Record<string, unknown> = { level: "moderate" };
    const policy = makePolicy({ options: () => options });
    expect(policy.filterLevel()).toBe("moderate");
    options.level = "strict";
    expect(policy.filterLevel()).toBe("strict");
  });

  it("defaults to off when the game declares no filterLevel", () => {
    const policy = makePolicy({ definition: PlainGame });
    expect(policy.filterLevel()).toBe("off");
  });

  it("reports the filter reason only for names that fail at the current level", () => {
    const policy = makePolicy();
    expect(policy.rejected("Ann")).toBeUndefined();
    expect(policy.rejected("bad name")).toBe("contains inappropriate language");
    // off passes everything, filtered or not
    expect(makePolicy({ options: () => ({ level: "off" }) }).rejected("bad name")).toBeUndefined();
  });

  it("has no rejections when the server configured no filter", () => {
    const policy = makePolicy({ textFilter: undefined });
    expect(policy.rejected("bad name")).toBeUndefined();
  });

  it("treats names as taken case-insensitively and trimmed, excluding the seat itself", () => {
    const seats = [seatOf("p1", "Ann"), seatOf("p2", "  ann ")];
    const policy = makePolicy({ players: () => seats });
    expect(policy.taken("p1", "ann")).toBe(true); // p2's name matches, trimmed and case-insensitively
    expect(policy.taken("p1", "ANN ")).toBe(true);
    expect(policy.taken("p3", "Zed")).toBe(false);

    const solo = makePolicy({ players: () => [seatOf("p1", "Ann")] });
    expect(solo.taken("p1", "Ann")).toBe(false); // the seat's own name does not count
    expect(solo.taken("p2", "ann")).toBe(true);
  });
});
