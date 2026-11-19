import type { Client } from "@colyseus/core";
import { GameRuntime } from "@openparty/core";
import { FakeHost } from "@openparty/core/testing";
import { CLIENT_MESSAGES, ClientMessage, ErrorCode, ServerMessage } from "@openparty/shared";
import { BaseGameState, PlayerSchema } from "@openparty/shared/schema";
import { describe, expect, it } from "vitest";
import type { ResolvedRateLimits } from "../src/RateLimiter.js";
import {
  ActionRouter,
  type ActionRouterDeps,
  type RoutedPhase,
} from "../src/rooms/ActionRouter.js";
import { ReplayRecorder } from "../src/rooms/ReplayRecorder.js";
import { SeatRegistry } from "../src/rooms/SeatRegistry.js";
import { PlainGame } from "./fixtures/buzzer.js";

const RATE_LIMITED = {
  ok: false,
  error: { code: ErrorCode.RATE_LIMITED, message: CLIENT_MESSAGES.RATE_LIMITED },
};
const SPECTATOR = {
  ok: false,
  error: { code: ErrorCode.UNAUTHORIZED, message: CLIENT_MESSAGES.UNAUTHORIZED },
};
const INTERNAL = {
  ok: false,
  error: { code: ErrorCode.INTERNAL, message: CLIENT_MESSAGES.INTERNAL },
};
const NOT_ALLOWED = {
  ok: false,
  error: { code: ErrorCode.NOT_ALLOWED, message: CLIENT_MESSAGES.NOT_ALLOWED },
};

/** A one-phase table: `VOTE` is audience-declared, `TAP` is a player action. */
const PHASES: Record<string, RoutedPhase> = {
  Play: { actions: { VOTE: { from: "audience" }, TAP: { from: "player" } } },
};

const LIMITS: ResolvedRateLimits = {
  action: { rate: 10, burst: 20 },
  setName: { rate: 2, burst: 2 },
  resolveCode: { rate: 1, burst: 10 },
  exportReplay: { rate: 0.2, burst: 1 },
  mode: "enforce",
};

/** A fresh runtime with no action log: the token the router hands to the recorder on export. */
const freshRuntime = (): GameRuntime<
  BaseGameState,
  Record<string, never>,
  Record<string, unknown>
> =>
  new GameRuntime({
    definition: PlainGame,
    state: new BaseGameState(),
    options: {},
    host: new FakeHost(),
  });

/** A minimal fake client: the router only ever reads `sessionId` and pushes to `send`. */
const fakeClient = (sessionId: string): { client: Client; sent: Array<[string, unknown]> } => {
  const sent: Array<[string, unknown]> = [];
  return {
    client: {
      sessionId,
      send: (type: string, payload?: unknown) => {
        sent.push([type, payload]);
      },
    } as Client,
    sent,
  };
};

const seatOf = (id: string, role: "host" | "player" = "player"): PlayerSchema => {
  const seat = new PlayerSchema();
  seat.id = id;
  seat.role = role;
  return seat;
};

const makeRouter = (overrides: Partial<ActionRouterDeps> = {}): ActionRouter => {
  const runtime = freshRuntime();
  const deps: ActionRouterDeps = {
    seats: new SeatRegistry(() => []),
    seatBySession: () => undefined,
    phase: () => "Play",
    phases: PHASES,
    dispatch: () => undefined,
    dispatchAudience: () => undefined,
    take: () => true,
    roomId: () => "room-1",
    rateLimits: LIMITS,
    recorder: new ReplayRecorder(PlainGame, 8, []),
    runtime: () => runtime,
    logLine: () => {},
    ...overrides,
  };
  return new ActionRouter(deps);
};

describe("ActionRouter (unit)", () => {
  it("dispatches a seated action under the per-seat bucket and answers ok", () => {
    const dispatched: Array<[string, unknown]> = [];
    const { client } = fakeClient("s1");
    const router = makeRouter({
      seatBySession: () => seatOf("p1"),
      dispatch: (playerId, raw) => {
        dispatched.push([playerId, raw]);
      },
    });
    expect(router.action(client, { type: "TAP" })).toEqual({ ok: true });
    expect(dispatched).toEqual([["p1", { type: "TAP" }]]);
  });

  it("answers RATE_LIMITED and pushes the fixed error when the seat's bucket is exhausted", () => {
    let dispatched = false;
    const { client, sent } = fakeClient("s1");
    const router = makeRouter({
      seatBySession: () => seatOf("p1"),
      take: (key) => key !== `room-1:p1:${ClientMessage.ACTION}`,
      dispatch: () => {
        dispatched = true;
      },
    });
    expect(router.action(client, { type: "TAP" })).toEqual(RATE_LIMITED);
    expect(sent).toContainEqual([ServerMessage.ERROR, RATE_LIMITED.error]);
    expect(dispatched).toBe(false);
  });

  it("logs a runtime rejection by code and action type only, never the payload", () => {
    const lines: Array<[string, string, unknown]> = [];
    const { client } = fakeClient("s1");
    const router = makeRouter({
      seatBySession: () => seatOf("p1"),
      dispatch: () => ({ code: ErrorCode.NOT_ALLOWED, message: "no" }),
      logLine: (level, event, fields) => lines.push([level, event, fields]),
    });
    expect(router.action(client, { type: "TAP", note: "Zxq9-Payload" })).toEqual({
      ok: false,
      error: { code: ErrorCode.NOT_ALLOWED, message: "no" },
    });
    expect(lines).toEqual([
      ["warn", "action.rejected", { code: ErrorCode.NOT_ALLOWED, action: "TAP" }],
    ]);
  });

  it("answers ACTION_FAILED with the fixed error when a dispatch throws", () => {
    const lines: Array<[string, string, unknown]> = [];
    const { client } = fakeClient("s1");
    const router = makeRouter({
      seatBySession: () => seatOf("p1"),
      dispatch: () => {
        throw new Error("boom");
      },
      logLine: (level, event, fields) => lines.push([level, event, fields]),
    });
    expect(router.action(client, { type: "TAP" })).toEqual(INTERNAL);
    expect(lines).toEqual([
      ["warn", "action.rejected", { code: ErrorCode.INTERNAL, action: "TAP" }],
    ]);
  });

  describe("the audience path for seatless connections", () => {
    const spectatorRouter = (overrides: Partial<ActionRouterDeps> = {}) => {
      const seats = new SeatRegistry(() => []);
      seats.addSpectator("s1", "aud-0001");
      return makeRouter({ seats, ...overrides });
    };

    it("refuses an action not declared from: 'audience' with the spectator error", () => {
      let audienceDispatched = false;
      const { client, sent } = fakeClient("s1");
      const router = spectatorRouter({
        dispatchAudience: () => {
          audienceDispatched = true;
        },
      });
      expect(router.action(client, { type: "TAP" })).toEqual(SPECTATOR);
      expect(sent).toContainEqual([ServerMessage.ERROR, SPECTATOR.error]);
      expect(audienceDispatched).toBe(false);
    });

    it("refuses a malformed envelope even for an audience-declared action", () => {
      let audienceDispatched = false;
      const { client } = fakeClient("s1");
      const router = spectatorRouter({
        dispatchAudience: () => {
          audienceDispatched = true;
        },
      });
      expect(router.action(client, { noType: true })).toEqual(SPECTATOR);
      expect(audienceDispatched).toBe(false);
    });

    it("refuses a seatless connection that is not a registered spectator", () => {
      const { client } = fakeClient("s1");
      // the default router has an empty SeatRegistry: no join playerId behind the session
      expect(makeRouter().action(client, { type: "VOTE" })).toEqual(SPECTATOR);
    });

    it("dispatches an audience-declared action keyed by the spectator's join playerId", () => {
      const dispatched: Array<[string, unknown]> = [];
      const { client } = fakeClient("s1");
      const router = spectatorRouter({
        dispatchAudience: (playerId, raw) => {
          dispatched.push([playerId, raw]);
        },
      });
      expect(router.action(client, { type: "VOTE", option: "a" })).toEqual({ ok: true });
      expect(dispatched).toEqual([["aud-0001", { type: "VOTE", option: "a" }]]);
    });

    it("rate-limits a seatless connection on its own per-connection bucket", () => {
      const { client, sent } = fakeClient("s1");
      const router = spectatorRouter({ take: () => false });
      expect(router.action(client, { type: "VOTE" })).toEqual(RATE_LIMITED);
      expect(sent).toContainEqual([ServerMessage.ERROR, RATE_LIMITED.error]);
    });

    it("answers ACTION_FAILED when an audience dispatch throws", () => {
      const { client } = fakeClient("s1");
      const router = spectatorRouter({
        dispatchAudience: () => {
          throw new Error("boom");
        },
      });
      expect(router.action(client, { type: "VOTE" })).toEqual(INTERNAL);
    });
  });

  describe("the EXPORT_REPLAY handler", () => {
    it("refuses a non-host seat with the spectator error before spending any bucket", () => {
      const taken: string[] = [];
      const { client } = fakeClient("s1");
      const router = makeRouter({
        seatBySession: () => seatOf("p2"),
        take: (key) => {
          taken.push(key);
          return true;
        },
      });
      expect(router.exportReplay(client)).toEqual(SPECTATOR);
      expect(taken).toEqual([]);
    });

    it("rate-limits a host's export on the export bucket", () => {
      const { client, sent } = fakeClient("s1");
      const router = makeRouter({
        seatBySession: () => seatOf("p1", "host"),
        take: (key) => key !== `room-1:p1:${ClientMessage.EXPORT_REPLAY}`,
      });
      expect(router.exportReplay(client)).toEqual(RATE_LIMITED);
      expect(sent).toContainEqual([ServerMessage.ERROR, RATE_LIMITED.error]);
    });

    it("hands a host through to the recorder: without an action log the export refuses", () => {
      const { client } = fakeClient("s1");
      const router = makeRouter({ seatBySession: () => seatOf("p1", "host") });
      expect(router.exportReplay(client)).toEqual(NOT_ALLOWED);
    });
  });
});
