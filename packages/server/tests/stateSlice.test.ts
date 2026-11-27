import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootTestServer, type TestServer, waitUntil } from "../src/testing/index.js";
import { Note, SLICE_PUBLIC_FIELDS, Slice, SliceGame, SliceState } from "./fixtures/stateSlice.js";
import { pid } from "./support.js";

const GAMES = [
  {
    roomName: "slice",
    definition: SliceGame,
    stateClass: SliceState,
    publicFields: SLICE_PUBLIC_FIELDS,
  },
];

let t: TestServer;
beforeAll(async () => {
  t = await bootTestServer({ games: GAMES });
});
afterEach(() => t.cleanup());
afterAll(() => t.shutdown());

async function expectSliceSync(
  p1: { send: (type: string, payload: unknown) => unknown; state: unknown },
  p2: { state: unknown },
): Promise<void> {
  p1.send("ACTION", { type: "SET_MODULE" });
  await waitUntil(
    () => (p1.state as SliceState | undefined)?.slice?.round === 1,
    "p1 slice synced",
  );
  await waitUntil(
    () => (p2.state as SliceState | undefined)?.slice?.mine?.size === 1,
    "p2 slice synced",
  );
}

describe("pluggable state slice", () => {
  it("decodes on the client, keeps per-player fields private, survives reconnect", async () => {
    const room = await t.createRoom("slice");
    const p1 = await t.joinAs(room, { playerId: pid(1) }, SliceState);
    const p2 = await t.joinAs(room, { playerId: pid(2) }, SliceState);
    p1.send("SET_NAME", "P1");
    p2.send("SET_NAME", "P2");
    await waitUntil(
      () => (p1.state as { phase?: string } | undefined)?.phase === "Play",
      "game started",
    );

    await expectSliceSync(p1, p2);

    const state = p1.state as SliceState;
    expect(state.slice).toBeInstanceOf(Slice);
    expect(state.slice.label).toBe("round-1");
    expect(state.slice.scores.get(pid(1))).toBe(10);
    expect(state.slice.scores.get(pid(2))).toBe(20);
    expect(JSON.parse(state.slice.payload)).toEqual({ total: 30 });
    expect([...state.slice.mine.keys()]).toEqual([pid(1)]);
    expect(state.slice.mine.get(pid(1))).toBeInstanceOf(Note);
    expect(state.slice.mine.get(pid(1))?.note).toBe(`note-${pid(1)}`);

    const state2 = p2.state as SliceState;
    expect([...state2.slice.mine.keys()]).toEqual([pid(2)]);
    expect(state2.slice.mine.get(pid(2))?.note).toBe(`note-${pid(2)}`);

    const token = p2.reconnectionToken;
    await p2.leave(false);
    const back = await t.sdk.reconnect(token);
    await waitUntil(
      () => (back.state as SliceState | undefined)?.players?.has(pid(2)) === true,
      "p2 back",
    );
    await waitUntil(
      () => (back.state as SliceState | undefined)?.slice?.mine?.has(pid(2)) === true,
      "note restored",
    );
    const restored = back.state as SliceState;
    expect([...restored.slice.mine.keys()]).toEqual([pid(2)]);
  });

  it("decodes on the client without a root class passed to join", async () => {
    const room = await t.createRoom("slice");
    const p1 = await t.join(room, { playerId: pid(1) });
    const p2 = await t.join(room, { playerId: pid(2) });
    p1.send("SET_NAME", "P1");
    p2.send("SET_NAME", "P2");
    await waitUntil(
      () => (p1.state as { phase?: string } | undefined)?.phase === "Play",
      "game started",
    );

    await expectSliceSync(p1, p2);

    const state = p1.state as SliceState;
    // No root class at join: the SDK builds dynamic mirrors, so `instanceof`
    // against the game's classes does not hold — only the shape is guaranteed.
    expect(state.slice.label).toBe("round-1");
    expect(state.slice.scores.get(pid(1))).toBe(10);
    expect(JSON.parse(state.slice.payload)).toEqual({ total: 30 });
    expect([...state.slice.mine.keys()]).toEqual([pid(1)]);
    expect(state.slice.mine.get(pid(1))?.note).toBe(`note-${pid(1)}`);

    const token = p2.reconnectionToken;
    await p2.leave(false);
    const back = await t.sdk.reconnect(token);
    await waitUntil(
      () => (back.state as SliceState | undefined)?.players?.has(pid(2)) === true,
      "p2 back",
    );
    await waitUntil(
      () => (back.state as SliceState | undefined)?.slice?.mine?.has(pid(2)) === true,
      "note restored",
    );
    expect([...(back.state as SliceState).slice.mine.keys()]).toEqual([pid(2)]);
  });
});
