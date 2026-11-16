import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineGame,
  type GameDefinition,
  GameRuntime,
  type HostMigration,
  type PhaseState,
  type PlayerInfo,
} from "../../src/index.js";
import { pickNextHost } from "../../src/runtime/hostMigration.js";
import { FakeHost } from "../../src/testing/FakeHost.js";

type Spec = GameDefinition<PhaseState>;

function makeTable(hostMigration: Spec["hostMigration"], seed = 0) {
  const host = new FakeHost(seed);
  const state: PhaseState = { phase: "", phaseEndsAt: 0, canStart: false };
  const spec = defineGame<PhaseState>({
    name: "HostMigration",
    version: "1",
    minPlayers: 2,
    maxPlayers: 4,
    startPhase: "Play",
    options: z.object({}),
    createPrivateState: () => ({}),
    phases: { Play: {} },
    ...(hostMigration === undefined ? {} : { hostMigration }),
  });
  const runtime = new GameRuntime<PhaseState, Record<string, never>, Record<string, unknown>>({
    definition: spec,
    state,
    options: {},
    host,
  });
  return { host, runtime };
}

const roleOf = (host: FakeHost, id: string) => host.players().find((p) => p.id === id)?.role;

/** p1 is the disconnected host; p2 and p3 are connected. */
function seats(
  host: FakeHost,
  p2: Partial<Parameters<FakeHost["seat"]>[1]> = {},
  p3: Partial<Parameters<FakeHost["seat"]>[1]> = {},
) {
  host.seat("p1", { isConnected: false });
  host.seat("p2", p2);
  host.seat("p3", p3);
}

describe("host migration", () => {
  it("defaults to next-seated: first connected seat that is active and ready", () => {
    const { host, runtime } = makeTable(undefined);
    seats(host); // p2 and p3 are both active and ready by default
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("player");
    expect(roleOf(host, "p2")).toBe("host");
    expect(roleOf(host, "p3")).toBe("player");
  });

  it("falls back to the first connected ready seat when none is active", () => {
    const { host, runtime } = makeTable(undefined);
    seats(host, { isActive: false }, { isActive: false });
    runtime.rosterChanged();
    expect(roleOf(host, "p2")).toBe("host");
  });

  it("falls back to the first connected seat when none is ready", () => {
    const { host, runtime } = makeTable(undefined);
    seats(host, { isReady: false, isActive: false }, { isReady: false, isActive: false });
    runtime.rosterChanged();
    expect(roleOf(host, "p2")).toBe("host");
  });

  it("promotes with the default policy when no seat holds the host role", () => {
    const { host, runtime } = makeTable(undefined);
    host.seat("p1", { role: "player" });
    host.seat("p2", { role: "player" });
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("host");
  });

  it("keeps the connected host in place and migrates nobody else", () => {
    const { host, runtime } = makeTable("oldest");
    host.seat("p1");
    host.seat("p2");
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("host");
    expect(roleOf(host, "p2")).toBe("player");
  });

  it("migrates to nobody when no seat is connected", () => {
    const { host, runtime } = makeTable(undefined);
    host.seat("p1", { isConnected: false });
    host.seat("p2", { isConnected: false });
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("host");
    expect(roleOf(host, "p2")).toBe("player");
  });

  it('"oldest" takes the first connected seat regardless of ready or active', () => {
    const { host, runtime } = makeTable("oldest");
    seats(host, { isReady: false, isActive: false }); // p3 is ready and active
    runtime.rosterChanged();
    expect(roleOf(host, "p2")).toBe("host");
  });

  it('"random" picks from the candidates and is reproducible from the seed', () => {
    const first = makeTable("random", 42);
    seats(first.host);
    first.runtime.rosterChanged();
    const picked = first.host.players().find((p) => p.role === "host")?.id;
    expect(["p2", "p3"]).toContain(picked);

    const again = makeTable("random", 42);
    seats(again.host);
    again.runtime.rosterChanged();
    expect(again.host.players().find((p) => p.role === "host")?.id).toBe(picked);
  });

  it('"none" keeps the room host-less until the old host returns', () => {
    const { host, runtime } = makeTable("none");
    seats(host);
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("host");
    expect(roleOf(host, "p2")).toBe("player");
  });

  it("lets a HostPicker choose among the connected seats", () => {
    const policy: HostMigration = (candidates, rng) =>
      candidates[Math.floor(rng() * candidates.length)]?.id;
    const { host, runtime } = makeTable(policy, 7);
    seats(host);
    runtime.rosterChanged();
    expect(["p2", "p3"]).toContain(host.players().find((p) => p.role === "host")?.id);
  });

  it("keeps the old host when a HostPicker returns undefined", () => {
    const policy: HostMigration = () => undefined;
    const { host, runtime } = makeTable(policy);
    seats(host);
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("host");
  });

  it("migrates to nobody when the host supplies no setHost", () => {
    const { host, runtime } = makeTable(undefined);
    delete host.setHost;
    seats(host);
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("host");
  });

  it("consults no picker and draws no rng when the host has no setHost", () => {
    let pickerCalls = 0;
    const policy: HostMigration = (_candidates, rng) => {
      pickerCalls += 1;
      rng(); // a draw the replay stream must never consume
      return undefined;
    };
    const { host, runtime } = makeTable(policy);
    delete host.setHost;
    let draws = 0;
    const draw = host.rng.bind(host);
    host.rng = () => {
      draws += 1;
      return draw();
    };
    seats(host);
    runtime.rosterChanged();
    expect(pickerCalls).toBe(0);
    expect(draws).toBe(0);
    expect(roleOf(host, "p1")).toBe("host");
  });

  it("keeps the old host when a HostPicker returns a non-candidate id", () => {
    const policy: HostMigration = () => "ghost";
    const { host, runtime } = makeTable(policy);
    seats(host);
    runtime.rosterChanged();
    expect(roleOf(host, "p1")).toBe("host");
    expect(roleOf(host, "p2")).toBe("player");
    expect(roleOf(host, "p3")).toBe("player");
  });
});

const seat = (id: string, over: Partial<PlayerInfo> = {}): PlayerInfo => ({
  id,
  name: id,
  role: "player",
  isConnected: true,
  isReady: true,
  isActive: true,
  ...over,
});

describe("pickNextHost (pure)", () => {
  it('"oldest" picks the first connected seat regardless of ready or active', () => {
    const players = [
      seat("a", { isConnected: false }),
      seat("b", { isReady: false, isActive: false }),
      seat("c"),
    ];
    expect(pickNextHost("oldest", players, () => 0.5)).toBe("b");
  });

  it('"next-seated" prefers the first connected seat that is active and ready', () => {
    const players = [seat("a", { isActive: false }), seat("b"), seat("c")];
    expect(pickNextHost("next-seated", players, () => 0.5)).toBe("b");
  });

  it('"next-seated" falls back to the first connected ready seat when none is active', () => {
    const players = [seat("a", { isActive: false }), seat("b", { isActive: false })];
    expect(pickNextHost("next-seated", players, () => 0.5)).toBe("a");
  });

  it('"next-seated" falls back to the first connected seat when none is ready', () => {
    const players = [seat("a", { isReady: false }), seat("b", { isReady: false })];
    expect(pickNextHost("next-seated", players, () => 0.5)).toBe("a");
  });

  it('"random" draws one of the connected seats with the rng', () => {
    const players = [seat("a"), seat("b")];
    expect(pickNextHost("random", players, () => 0.9)).toBe("b"); // floor(0.9 * 2) = 1
    expect(pickNextHost("random", players, () => 0.1)).toBe("a");
  });

  it('"none" returns undefined and never draws the rng', () => {
    let draws = 0;
    const rng = () => {
      ++draws;
      return 0.5;
    };
    expect(pickNextHost("none", [seat("a")], rng)).toBeUndefined();
    expect(draws).toBe(0);
  });

  it("returns undefined when no seat is connected, without consulting the policy", () => {
    let pickerCalls = 0;
    const policy: HostMigration = (candidates) => {
      ++pickerCalls;
      return candidates[0]?.id;
    };
    expect(pickNextHost(policy, [seat("a", { isConnected: false })], () => 0.5)).toBeUndefined();
    expect(pickerCalls).toBe(0);
  });

  it("lets a HostPicker choose among the connected seats only", () => {
    const policy: HostMigration = (candidates) => candidates[0]?.id;
    expect(pickNextHost(policy, [seat("a", { isConnected: false }), seat("b")], () => 0.5)).toBe(
      "b",
    );
  });

  it("ignores a picker id outside the connected seats", () => {
    const policy: HostMigration = () => "ghost";
    expect(pickNextHost(policy, [seat("a"), seat("b")], () => 0.5)).toBeUndefined();
  });

  it("keeps the current host when a picker returns undefined", () => {
    const policy: HostMigration = () => undefined;
    expect(pickNextHost(policy, [seat("a")], () => 0.5)).toBeUndefined();
  });
});
