import type { LogFields, Logger } from "@openparty/core";
import { type ActionResult, ClientMessage, ErrorCode } from "@openparty/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { TestServer } from "../src/testing/index.js";
import { bootRated, pid, type Seated, sleep, startedRated } from "./support.js";

let t: TestServer | undefined;
afterEach(async () => {
  await t?.shutdown();
  t = undefined;
});

const send = (who: Seated, type: string): Promise<ActionResult> =>
  who.client.request<unknown, ActionResult>(ClientMessage.ACTION, { type });

const rateLimited = (result: ActionResult): boolean =>
  result.ok === false && result.error.code === ErrorCode.RATE_LIMITED;

describe("GameRoom per-action rate limits", () => {
  it("accepts a burst on an action's own bucket while other actions keep the shared one", async () => {
    t = await bootRated({ rateLimits: { action: { rate: 0.001, burst: 3 } } });
    const { p1 } = await startedRated(t);
    for (let i = 0; i < 10; ++i) expect(await send(p1, "FAST")).toEqual({ ok: true });
    for (let i = 0; i < 3; ++i) expect(await send(p1, "PLAIN")).toEqual({ ok: true });
    expect(rateLimited(await send(p1, "PLAIN"))).toBe(true); // FAST never spent the shared bucket
  });

  it("accepts a 12/s action's full burst and refuses the tap after it", async () => {
    // The #306/#448 figure: a real-time tap action declares about 12 taps per second.
    t = await bootRated({ rateLimits: { action: { rate: 1000, burst: 1000 } } });
    const { p1 } = await startedRated(t);
    for (let i = 0; i < 12; ++i) expect(await send(p1, "TAP")).toEqual({ ok: true });
    expect(rateLimited(await send(p1, "TAP"))).toBe(true);
  });

  it("refuses a lower-limit action sooner and leaves the shared bucket alone", async () => {
    t = await bootRated({ rateLimits: { action: { rate: 0.001, burst: 3 } } });
    const { p1 } = await startedRated(t);
    expect(await send(p1, "SLOW")).toEqual({ ok: true });
    expect(rateLimited(await send(p1, "SLOW"))).toBe(true);
    expect(await send(p1, "PLAIN")).toEqual({ ok: true });
  });

  it("shares the default bucket between malformed envelopes, undeclared types and plain actions", async () => {
    t = await bootRated({ rateLimits: { action: { rate: 0.001, burst: 2 } } });
    const { p1 } = await startedRated(t);
    const unknown = { ok: false, error: { code: ErrorCode.UNKNOWN_ACTION } };
    expect(await send(p1, "NOPE")).toMatchObject(unknown);
    expect(await send(p1, "NOPE")).toMatchObject(unknown);
    expect(rateLimited(await send(p1, "NOPE"))).toBe(true); // unknown types do not mint their own bucket
    expect(
      rateLimited(
        await p1.client.request<unknown, ActionResult>(ClientMessage.ACTION, { noType: true }),
      ),
    ).toBe(true);
    expect(rateLimited(await send(p1, "PLAIN"))).toBe(true);
  });

  it("honours observe mode on an action's own bucket and reports the type-keyed hit", async () => {
    const lines: Array<{ event: string; fields?: LogFields | undefined }> = [];
    const logger: Logger = {
      info: () => {},
      warn: (event, fields) => {
        lines.push({ event, fields });
      },
      error: () => {},
    };
    t = await bootRated({ rateLimits: { mode: "observe" }, logger });
    const { p1 } = await startedRated(t);
    expect(await send(p1, "SLOW")).toEqual({ ok: true });
    expect(await send(p1, "SLOW")).toEqual({ ok: true }); // over its bucket, but only observed
    const hit = lines.find((line) => line.event === "rate.limit");
    expect(hit?.fields?.key).toContain(`:${pid(1)}:${ClientMessage.ACTION}:SLOW`);
  });

  it("gives a spectator's audience action its own bucket while its shared bucket stays separate", async () => {
    t = await bootRated({ rateLimits: { action: { rate: 0.001, burst: 2 } } });
    const { room } = await startedRated(t);
    const spec = await t.join(room, { playerId: "aud-0001", spectator: true });
    for (let i = 0; i < 10; ++i) {
      expect(
        await spec.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "CHEER" }),
      ).toEqual({ ok: true });
    }
    for (let i = 0; i < 2; ++i) {
      expect(
        await spec.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
      ).toEqual({ ok: true });
    }
    expect(
      rateLimited(
        await spec.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
      ),
    ).toBe(true);
  });

  it("keeps a spectator's bucket across an abnormal drop so a rejoin cannot reset it", async () => {
    t = await bootRated({ reconnectMs: 20, rateLimits: { action: { rate: 0, burst: 1 } } });
    const { room } = await startedRated(t);
    const spec = await t.join(room, { playerId: "aud-0001", spectator: true });
    expect(
      await spec.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
    ).toEqual({ ok: true });
    await spec.leave(false); // abnormal drop: the bucket outlives the seat reconnection window
    const back = await t.join(room, { playerId: "aud-0001", spectator: true });
    expect(
      rateLimited(
        await back.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
      ),
    ).toBe(true);
    await sleep(100); // the cleanup timer fires while the same join playerId is still connected
    expect(
      rateLimited(
        await back.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
      ),
    ).toBe(true);
  });

  it("forgets a spectator's bucket after an abnormal drop once nobody rejoined", async () => {
    t = await bootRated({ reconnectMs: 20, rateLimits: { action: { rate: 0, burst: 1 } } });
    const { room } = await startedRated(t);
    const spec = await t.join(room, { playerId: "aud-0001", spectator: true });
    expect(
      await spec.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
    ).toEqual({ ok: true });
    await spec.leave(false);
    await sleep(100); // the reconnection window passes with nobody holding the id
    const back = await t.join(room, { playerId: "aud-0001", spectator: true });
    expect(
      await back.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
    ).toEqual({ ok: true }); // a fresh bucket
  });

  it("forgets a spectator's bucket on a consented leave", async () => {
    t = await bootRated({ rateLimits: { action: { rate: 0, burst: 1 } } });
    const { room } = await startedRated(t);
    const spec = await t.join(room, { playerId: "aud-0001", spectator: true });
    expect(
      await spec.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
    ).toEqual({ ok: true });
    await spec.leave();
    const back = await t.join(room, { playerId: "aud-0001", spectator: true });
    expect(
      await back.request<unknown, ActionResult>(ClientMessage.ACTION, { type: "VOTE" }),
    ).toEqual({ ok: true });
  });
});
