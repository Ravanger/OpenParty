import { Encoder, Reflection, Schema, t } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import { BaseGameState } from "../src/schema/BaseGameState.js";
import { syncedJsonOf, syncedStateFromJson } from "../src/schema/index.js";
import { PlayerSchema } from "../src/schema/PlayerSchema.js";

const TestState = BaseGameState.extend({ winner: t.string().default("") }, "TestState");

describe("BaseGameState", () => {
  it("has the shared defaults", () => {
    expect(new BaseGameState().toJSON()).toEqual({
      phase: "Lobby",
      roomCode: "",
      phaseEndsAt: 0,
      phaseDurationMs: 0,
      pausedAt: 0,
      serverNow: 0,
      spectatorCount: 0,
      options: "{}",
      notice: "",
      minPlayers: 0,
      maxPlayers: 0,
      canStart: false,
      players: {},
    });
  });

  it("keeps the phaseDurationMs default when hydrating state recorded before it existed", () => {
    const oldJson = syncedJsonOf(new TestState());
    delete oldJson.phaseDurationMs;
    const state = syncedStateFromJson(TestState, oldJson);
    expect(state.phaseDurationMs).toBe(0);
  });

  it("registers the base fields on a subclass", () => {
    const state = new TestState();
    state.winner = "p";
    state.players.set("a", Object.assign(new PlayerSchema(), { id: "a" }));
    expect(state.toJSON()).toMatchObject({
      phase: "Lobby",
      winner: "p",
      players: { a: { id: "a", isActive: true } },
    });
    expect(state).toBeInstanceOf(Schema);
  });

  it("serialises the subclass fields", () => {
    const state = new TestState();
    state.winner = "w";
    const encoder = new Encoder(state);
    expect(encoder.encodeAll().length).toBeGreaterThan(0);
    expect(Reflection.encode(encoder).length).toBeGreaterThan(0);
  });
});
