import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootTestServer, type TestServer, waitUntil } from "../src/testing/index.js";
import {
  MODULE_PUBLIC_FIELDS,
  ModuleGame,
  ModuleState,
  type ModuleState as ModuleStateT,
} from "./fixtures/roundModule.js";
import { pid } from "./support.js";

const GAMES = [
  {
    roomName: "module",
    definition: ModuleGame,
    stateClass: ModuleState,
    publicFields: MODULE_PUBLIC_FIELDS,
  },
];

let t: TestServer;
beforeAll(async () => {
  t = await bootTestServer({ games: GAMES });
});
afterEach(() => t.cleanup());
afterAll(() => t.shutdown());

describe("mounted round module", () => {
  it("runs the module end to end through a live server", async () => {
    const room = await t.createRoom("module");
    const p1 = await t.joinAs(room, { playerId: pid(1) }, ModuleState);
    const p2 = await t.joinAs(room, { playerId: pid(2) }, ModuleState);
    p1.send("SET_NAME", "P1");
    p2.send("SET_NAME", "P2");
    await waitUntil(
      () => (p1.state as ModuleStateT | undefined)?.phase === "MOD_Tap",
      "module entered",
    );

    // Both players tap through the module's prefixed action.
    p1.send("ACTION", { type: "MOD__TAP" });
    p1.send("ACTION", { type: "MOD__TAP" });
    p2.send("ACTION", { type: "MOD__TAP" });
    await waitUntil(
      () => (p1.state as ModuleStateT | undefined)?.round?.taps?.size === 2,
      "taps synced",
    );

    // The Tap phase times out into Reveal, then the module finishes: the host records the
    // total and clears the way to its own Done phase.
    await waitUntil(
      () => (p1.state as ModuleStateT | undefined)?.phase === "Done",
      "module finished",
      10_000,
    );
    const state = p1.state as ModuleStateT;
    expect(state.round.taps.get(pid(1))).toBe(2);
    expect(state.round.taps.get(pid(2))).toBe(1);
    expect(state.total).toBe(3);
  });
});
