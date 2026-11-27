import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TestServer } from "../src/testing/index.js";
import { waitUntil } from "../src/testing/index.js";
import { bootBuzzer, clientState, pid, sleep, startedRoom, stateOf } from "./support.js";

let t: TestServer;
beforeAll(async () => {
  t = await bootBuzzer();
});
afterEach(() => t.cleanup());
afterAll(() => t.shutdown());

describe("GameRoom pause", () => {
  it("keeps a paused room open to reconnects and shows the pause to the returning client", async () => {
    const { room, p1, p2 } = await startedRoom(t);
    p1.client.send("ACTION", { type: "PAUSE_GAME" });
    await waitUntil(() => stateOf(room).pausedAt > 0, "paused");
    const pausedAt = stateOf(room).pausedAt;
    const endsBefore = stateOf(room).phaseEndsAt;
    const token = p2.client.reconnectionToken;
    await p2.client.leave(false);
    await waitUntil(() => stateOf(room).players.get(pid(2))?.isConnected === false, "dropped");
    // the frozen deadline does not run out while the room is paused
    await sleep(500);
    expect(stateOf(room).phaseEndsAt).toBe(endsBefore);
    const back = await t.sdk.reconnect(token);
    await waitUntil(() => stateOf(room).players.get(pid(2))?.isConnected === true, "back");
    // the reconnected client's snapshot carries the pause
    await waitUntil(
      () => (clientState(back) as { pausedAt?: number }).pausedAt === pausedAt,
      "pause visible to the returning client",
    );
    p1.client.send("ACTION", { type: "RESUME_GAME" });
    await waitUntil(() => stateOf(room).pausedAt === 0, "resumed");
  });

  it("survives a host drop: the promoted host resumes and the deadline shifts forward", async () => {
    const { room, p1, p2 } = await startedRoom(t);
    p1.client.send("ACTION", { type: "PAUSE_GAME" });
    await waitUntil(() => stateOf(room).pausedAt > 0, "paused");
    const endsBefore = stateOf(room).phaseEndsAt;
    const token = p1.client.reconnectionToken;
    await p1.client.leave(false);
    await waitUntil(() => stateOf(room).players.get(pid(2))?.role === "host", "promoted");
    expect(stateOf(room).pausedAt).toBeGreaterThan(0);
    await sleep(300);
    p2.client.send("ACTION", { type: "RESUME_GAME" });
    await waitUntil(() => stateOf(room).pausedAt === 0, "resumed by the new host");
    expect(stateOf(room).phaseEndsAt).toBeGreaterThan(endsBefore);
    // the old host coming back does not take the role or clear anything
    const back = await t.sdk.reconnect(token);
    await waitUntil(() => stateOf(room).players.get(pid(1))?.isConnected === true, "old host back");
    expect(stateOf(room).players.get(pid(2))?.role).toBe("host");
    await waitUntil(
      () => (clientState(back) as { pausedAt?: number }).pausedAt === 0,
      "running state visible to the old host",
    );
  });
});
