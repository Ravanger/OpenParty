import { ErrorCode } from "@openparty/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  actionFactory,
  defaultCoreStrings,
  defineGame,
  type GameContext,
  type MiddlewareContext,
  noopLogger,
  type PhaseMiddleware,
  type PhaseState,
} from "../../src/index.js";
import { MiddlewareChain, type MiddlewareChainDeps } from "../../src/runtime/MiddlewareChain.js";
import { TestTable } from "../../src/testing/TestTable.js";

interface S extends PhaseState {
  log: string[];
}
interface P {
  secret: string;
}
interface O {
  rounds: number;
}

const action = actionFactory<S, P, O>();

const game = (middleware: PhaseMiddleware<S, P, O>[], onError?: (error: unknown) => void) =>
  defineGame<S, P, O>({
    name: "Mw",
    version: "1",
    minPlayers: 1,
    maxPlayers: 4,
    startPhase: "Play",
    createPrivateState: () => ({ secret: "s" }),
    phases: {
      Play: {
        duration: 1000,
        onEnter: (ctx) => ctx.state.log.push("enter:Play"),
        onTimeout: (ctx) => ctx.transition("Score"),
        onRosterChange: (ctx) => ctx.state.log.push("roster"),
        actions: {
          GO: action({
            from: "player",
            payload: z.object({}),
            handler: (ctx) => ctx.transition("Score"),
          }),
          PING: action({
            from: "player",
            payload: z.object({}),
            handler: (ctx) => ctx.state.log.push("ping"),
          }),
          NOPE: action({
            from: "player",
            payload: z.object({}),
            handler: (ctx) => ctx.reject(ErrorCode.NOT_ALLOWED, "nope"),
          }),
          JUMP: action({
            from: "player",
            payload: z.object({}),
            handler: (ctx) => ctx.transition("Hop"),
          }),
          STAY: action({
            from: "player",
            payload: z.object({}),
            handler: (ctx) => ctx.transition("Play"),
          }),
        },
      },
      Hop: {
        onEnter: (ctx) => ctx.transition("Score"),
      },
      Score: {
        actions: {
          HOME: action({
            from: "host",
            payload: z.object({}),
            handler: (ctx) => ctx.returnToLobby(),
          }),
        },
      },
    },
    ...(onError ? { onError: (_ctx, error) => onError(error) } : {}),
    middleware,
  });

class MTable extends TestTable<S, P, O> {
  constructor(middleware: PhaseMiddleware<S, P, O>[] = [], onError?: (error: unknown) => void) {
    super({
      definition: game(middleware, onError),
      state: { phase: "", phaseEndsAt: 0, canStart: false, log: [] },
      options: { rounds: 2 },
      players: 2,
    });
  }
}

const layer =
  (name: string): PhaseMiddleware<S, P, O> =>
  (ctx, next) => {
    if (ctx.event.kind !== "enter") {
      next();
      return;
    }
    ctx.state.log.push(`${name}-in`);
    next();
    ctx.state.log.push(`${name}-out`);
  };

describe("middleware chain around onEnter", () => {
  it("runs middlewares outermost-first around the hook", () => {
    const table = new MTable([layer("a"), layer("b"), layer("c")]);
    table.state.log.length = 0;
    table.start();
    expect(table.state.log).toEqual([
      "a-in",
      "b-in",
      "c-in",
      "enter:Play",
      "c-out",
      "b-out",
      "a-out",
    ]);
  });

  it("skips the hook when a middleware omits next(), but still enters the phase", () => {
    // Skips only enter events so the START_GAME action can still flow.
    const skip: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind !== "enter") next();
    };
    const table = new MTable([skip]);
    table.state.log.length = 0;
    table.start();
    expect(table.phase).toBe("Play");
    expect(table.state.phaseEndsAt).toBeGreaterThan(0);
    expect(table.state.log).toEqual([]);
  });

  it("gives middleware the game context plus the event", () => {
    const seen: string[] = [];
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "enter") {
        seen.push(`${ctx.phase}|${ctx.priv.secret}|${ctx.options.rounds}`);
      }
      next();
    };
    const table = new MTable([mw]);
    table.start();
    expect(seen).toEqual(["Lobby|s|2", "Play|s|2"]);
  });
});

describe("middleware chain around action handlers", () => {
  const recordActions =
    (seen: string[]): PhaseMiddleware<S, P, O> =>
    (ctx, next) => {
      if (ctx.event.kind === "action") {
        seen.push(`${ctx.event.actionType} by ${ctx.event.senderId}`);
      }
      next();
    };

  it("sees the action type and sender for a player action", () => {
    const seen: string[] = [];
    const table = new MTable([recordActions(seen)]);
    table.start();
    seen.length = 0;
    table.act("p2", "GO");
    expect(seen).toEqual(["GO by p2"]);
  });

  it("wraps built-in actions too", () => {
    const seen: string[] = [];
    const table = new MTable([recordActions(seen)]);
    table.start();
    expect(seen).toEqual(["START_GAME by p1"]);
  });

  it("runs around the handler", () => {
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      ctx.state.log.push("mw-before");
      next();
      ctx.state.log.push("mw-after");
    };
    const table = new MTable([mw]);
    table.start();
    table.state.log.length = 0;
    table.act("p2", "PING");
    expect(table.state.log).toEqual(["mw-before", "ping", "mw-after"]);
  });

  it("keeps handler rejections identical with middleware registered", () => {
    const plain = new MTable();
    plain.start();
    plain.act("p2", "NOPE");
    const wrapped = new MTable([layer("x")]);
    wrapped.start();
    wrapped.act("p2", "NOPE");
    expect(wrapped.errors("p2")).toEqual(plain.errors("p2"));
  });
});

describe("rejectionCount after a handler-thrown FrameworkError", () => {
  it("sees the rejection inside the chain, with one ERROR message", () => {
    const counts: number[] = [];
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      next();
      if (ctx.event.kind === "action") counts.push(ctx.rejectionCount);
    };
    const table = new MTable([mw]);
    const result = table.act("p1", "END_GAME");
    expect(result).toMatchObject({ code: ErrorCode.WRONG_PHASE });
    expect(counts).toEqual([1]);
    expect(table.errors("p1")).toHaveLength(1);
  });
});

describe("middleware chain around onTimeout and onRosterChange", () => {
  const record =
    (kind: string, seen: string[]): PhaseMiddleware<S, P, O> =>
    (ctx, next) => {
      if (ctx.event.kind === kind) {
        seen.push(`${ctx.event.kind}:${ctx.phase}`);
      }
      next();
    };

  it("wraps onTimeout and fires it exactly once", () => {
    const seen: string[] = [];
    const table = new MTable([record("timeout", seen)]);
    table.start();
    table.tick(1000);
    expect(seen).toEqual(["timeout:Play"]);
    table.tick(5000);
    expect(seen).toEqual(["timeout:Play"]);
  });

  it("does not fire onTimeout after the phase has been left", () => {
    const seen: string[] = [];
    const table = new MTable([record("timeout", seen)]);
    table.start();
    table.act("p2", "GO");
    expect(table.phase).toBe("Score");
    table.tick(10_000);
    expect(seen).toEqual([]);
  });

  it("wraps onRosterChange for joinLate, leave and drop", () => {
    const seen: string[] = [];
    const table = new MTable([record("roster-change", seen)]);
    table.start();
    table.state.log.length = 0;
    table.joinLate("p3");
    expect(seen).toEqual(["roster-change:Play"]);
    expect(table.state.log).toContain("roster");
    seen.length = 0;
    table.state.log.length = 0;
    table.leave("p3");
    expect(seen).toEqual(["roster-change:Play"]);
    expect(table.state.log).toContain("roster");
    seen.length = 0;
    table.state.log.length = 0;
    table.drop("p2");
    expect(seen).toEqual(["roster-change:Play"]);
    expect(table.state.log).toContain("roster");
  });
});

describe("middleware transition observation", () => {
  const recordTransitions =
    (seen: string[]): PhaseMiddleware<S, P, O> =>
    (ctx, next) => {
      if (ctx.event.kind === "transition") {
        seen.push(`${ctx.event.from}->${ctx.event.to}`);
      }
      next();
    };

  it("records (from, to) for each applied transition", () => {
    const seen: string[] = [];
    const table = new MTable([recordTransitions(seen)]);
    table.start();
    expect(seen).toEqual(["Lobby->Play"]);
    table.act("p2", "GO");
    expect(seen).toEqual(["Lobby->Play", "Play->Score"]);
    table.act("p1", "HOME");
    expect(seen).toEqual(["Lobby->Play", "Play->Score", "Score->Lobby"]);
  });

  it("fires after the source enter chain has unwound", () => {
    const order: string[] = [];
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "enter") {
        order.push("h-in");
        next();
        order.push("h-out");
      } else if (ctx.event.kind === "transition") {
        const e = ctx.event;
        order.push(`t:${e.from}->${e.to}`);
        next();
      } else {
        next();
      }
    };
    const table = new MTable([mw]);
    table.start();
    order.length = 0;
    table.act("p2", "JUMP");
    expect(order).toEqual(["t:Play->Hop", "h-in", "h-out", "t:Hop->Score", "h-in", "h-out"]);
  });

  it("observes a re-entry as from === to", () => {
    const seen: string[] = [];
    const table = new MTable([recordTransitions(seen)]);
    table.start();
    seen.length = 0;
    table.act("p2", "STAY");
    expect(seen).toEqual(["Play->Play"]);
  });
});

describe("middleware throws behave like hook throws", () => {
  it("surfaces an action-path throw to the caller, drops queued transitions and returns to the Lobby", () => {
    // Baseline: GameRuntime.test.ts "drops queued transitions when a handler throws".
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "action" && ctx.event.actionType === "GO") {
        next();
        throw new Error("mw boom");
      }
      next();
    };
    const table = new MTable([mw]);
    table.start();
    expect(() => table.act("p2", "GO")).toThrow("mw boom");
    expect(table.phase).toBe("Lobby");
    expect(table.state.notice).toBeTruthy();
  });

  it("surfaces an enter-path throw to the caller, returns to the Lobby and keeps working", () => {
    // Baseline: GameRuntime.test.ts "surfaces an onEnter failure to the caller and keeps working".
    let explode = true;
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "enter" && ctx.phase === "Play" && explode) {
        throw new Error("mw enter boom");
      }
      next();
    };
    const table = new MTable([mw]);
    expect(() => table.start()).toThrow("mw enter boom");
    expect(table.phase).toBe("Lobby");
    expect(table.state.notice).toBeTruthy();
    explode = false;
    table.start();
    table.act("p2", "GO");
    expect(table.phase).toBe("Score");
  });

  it("surfaces a timeout-path throw to the timer's caller, returns to the Lobby and keeps working", () => {
    // Baseline: GameRuntime.test.ts "surfaces an onTimeout failure to the timer's caller and keeps working".
    let explode = true;
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "timeout" && explode) {
        throw new Error("mw timeout boom");
      }
      next();
    };
    const table = new MTable([mw]);
    table.start();
    expect(() => table.tick(1000)).toThrow("mw timeout boom");
    expect(table.phase).toBe("Lobby");
    expect(table.state.notice).toBeTruthy();
    explode = false;
    table.start();
    table.act("p2", "GO");
    expect(table.phase).toBe("Score");
  });

  it("surfaces a roster-path throw to the caller, returns to the Lobby and keeps working", () => {
    // No dedicated roster baseline in GameRuntime.test.ts: rosterChanged() runs inside run(),
    // so a throw propagates like the enter/timeout hook throws above.
    let explode = true;
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "roster-change" && explode) {
        throw new Error("mw roster boom");
      }
      next();
    };
    const table = new MTable([mw]);
    table.start();
    expect(() => table.leave("p2")).toThrow("mw roster boom");
    expect(table.phase).toBe("Lobby");
    expect(table.state.notice).toBeTruthy();
    explode = false;
    table.start();
    table.joinLate("p3");
    expect(table.state.log).toContain("roster");
  });

  it("applies the observed transition when a middleware throws on it, and surfaces the throw", () => {
    // Docs promise: "middleware cannot cancel a queued transition". An observer throw must defer
    // like any hook failure instead of dropping the transition it is observing.
    let explode = true;
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "transition" && ctx.event.to === "Play" && explode) {
        next();
        throw new Error("mw transition boom");
      }
      next();
    };
    const table = new MTable([mw]);
    expect(() => table.start()).toThrow("mw transition boom");
    // The observed transition still applied (Play was entered)…
    expect(table.state.log).toContain("enter:Play");
    // …and the default failure policy then returned the room to the Lobby.
    expect(table.phase).toBe("Lobby");
    expect(table.state.notice).toBeTruthy();
    explode = false;
    table.start();
    table.act("p2", "GO");
    expect(table.phase).toBe("Score");
  });
});

describe("middleware next() re-entrancy", () => {
  it("throws when a middleware calls next() twice for one enter event, and runs the hook once", () => {
    // Targets Play only: the initial Lobby enter happens at construction.
    let explode = true;
    const double: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "enter" && ctx.phase === "Play" && explode) {
        next();
        next();
      } else {
        next();
      }
    };
    const table = new MTable([double]);
    expect(() => table.start()).toThrow("middleware[0] called next() twice for one enter event");
    expect(table.state.log).toEqual(["enter:Play"]);
    expect(table.phase).toBe("Lobby");
    expect(table.state.notice).toBeTruthy();
    // The runtime keeps working after the throw, like any hook throw.
    explode = false;
    table.start();
    table.act("p2", "GO");
    expect(table.phase).toBe("Score");
  });

  it("throws when a middleware calls next() twice for one action event, and runs the handler once", () => {
    const double: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "action" && ctx.event.actionType === "PING") {
        next();
        next();
      } else {
        next();
      }
    };
    const table = new MTable([double]);
    table.start();
    table.state.log.length = 0;
    expect(() => table.act("p2", "PING")).toThrow(
      "middleware[0] called next() twice for one action event",
    );
    expect(table.state.log).toEqual(["ping"]);
  });
});

/** The one boundary an untyped layer crosses to reach the chain: a single cast from `unknown`. */
const smuggle = (layer: unknown): PhaseMiddleware<S, P, O> => layer as PhaseMiddleware<S, P, O>;

describe("middleware must be synchronous", () => {
  it("throws when a middleware returns a promise instead of running synchronously", () => {
    // Untyped by design: the compile-time rule (see tests/middleware.test.ts) is for typed
    // authors; this test drives the runtime backstop an untyped caller would hit.
    const slow = async (_ctx: MiddlewareContext<S, P, O>, next: () => void) => {
      await Promise.resolve();
      next();
    };
    const table = new MTable([smuggle(slow)]);
    // The initial Lobby enter fails at construction and is reported there, so start() sees only its own failure.
    let thrown: unknown;
    try {
      table.start();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeInstanceOf(AggregateError);
    expect(String(thrown)).toContain("middleware[0] returned a Promise");
  });

  it("ignores non-promise return values", () => {
    // Untyped by design, like the promise case above: this drives the runtime backstop.
    const tag = (_ctx: MiddlewareContext<S, P, O>, next: () => void) => {
      next();
      return {};
    };
    const table = new MTable([smuggle(tag)]);
    table.start();
    expect(table.act("p2", "PING")).toBeUndefined();
    expect(table.state.log).toContain("ping");
  });
});

describe("compile-time sync rule", () => {
  it("rejects an async layer at compile time and accepts a synchronous one", () => {
    // If the chain's return type were ever widened back to `void`, the async layer below would
    // become assignable, `rejected` would resolve to `true`, and this file would stop compiling.
    const asyncLayer = async (
      _ctx: MiddlewareContext<PhaseState, unknown, unknown>,
      next: () => void,
    ) => {
      next();
    };
    type IsAssignable<F, T> = F extends T ? true : false;
    const rejected: IsAssignable<
      typeof asyncLayer,
      PhaseMiddleware<PhaseState, unknown, unknown>
    > = false;
    expect(rejected).toBe(false);
    const sync: PhaseMiddleware<PhaseState, unknown, unknown> = (_ctx, next) => {
      next();
    };
    expect(sync).toBeTypeOf("function");
  });
});

describe("MiddlewareContext.reject", () => {
  it("stops the chain, reaches the sender and counts as a rejection", () => {
    const seen: number[] = [];
    const observe: PhaseMiddleware<S, P, O> = (ctx, next) => {
      next();
      if (ctx.event.kind === "action" && ctx.event.actionType === "PING")
        seen.push(ctx.rejectionCount);
    };
    const veto: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "action" && ctx.event.actionType === "PING") {
        ctx.reject(ErrorCode.NOT_ALLOWED, "no pinging");
        return;
      }
      next();
    };
    const table = new MTable([observe, veto]);
    table.start();
    const error = table.act("p2", "PING");
    expect(error).toEqual({ code: ErrorCode.NOT_ALLOWED, message: "no pinging", action: "PING" });
    expect(table.errors("p2")).toContainEqual(error);
    expect(seen).toEqual([1]);
    expect(table.state.log).toEqual(["enter:Play"]);
  });

  it("throws for non-action events, like a hook throw", () => {
    const vetoEnter: PhaseMiddleware<S, P, O> = (ctx, next) => {
      if (ctx.event.kind === "enter" && ctx.phase === "Play")
        ctx.reject(ErrorCode.NOT_ALLOWED, "no");
      next();
    };
    const errors: unknown[] = [];
    const table = new MTable([vetoEnter], (error) => errors.push(error));
    expect(() => table.start()).toThrow("only available for action events");
    expect(errors).toHaveLength(1);
    expect(table.state.notice).toBe("The game stopped because of an unexpected error.");
  });
});

const baseContext = (): GameContext<S, P, O> => ({
  state: { phase: "", phaseEndsAt: 0, canStart: false, log: [] },
  priv: { secret: "s" },
  options: { rounds: 2 },
  phase: "Play",
  players: () => [],
  activePlayers: () => [],
  player: () => undefined,
  activateWaitingPlayers: () => {},
  send: () => {},
  broadcast: () => {},
  showTo: () => {},
  hideFrom: () => {},
  transition: () => {},
  returnToLobby: () => {},
  rng: () => 0.5,
  newId: () => "id",
  now: () => 0,
  log: noopLogger,
  gameName: "Mw",
  gameVersion: "1",
  seed: [0, 0, 0, 0],
  strings: defaultCoreStrings,
});

const makeChain = (
  overrides: Partial<MiddlewareChainDeps<S, P, O>> = {},
): MiddlewareChain<S, P, O> =>
  new MiddlewareChain<S, P, O>({
    layers: [],
    context: baseContext,
    rejectionCount: () => 0,
    redactedRejectionCount: () => 0,
    ticks: () => undefined,
    reject: () => {},
    ...overrides,
  });

describe("MiddlewareChain (unit)", () => {
  it("runs the inner directly when there are no layers, without building a context", () => {
    let built = 0;
    const chain = makeChain({
      context: () => {
        ++built;
        return baseContext();
      },
    });
    let ran = false;
    chain.run({ kind: "enter" }, () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(built).toBe(0);
  });

  it("runs the layers outermost-first and shares one context object across them", () => {
    const order: string[] = [];
    const seen: unknown[] = [];
    const layer =
      (name: string): PhaseMiddleware<S, P, O> =>
      (ctx, next) => {
        seen.push(ctx);
        order.push(`${name}-in`);
        next();
        order.push(`${name}-out`);
      };
    const chain = makeChain({ layers: [layer("a"), layer("b")] });
    let innerRan = false;
    chain.run({ kind: "enter" }, () => {
      innerRan = true;
    });
    expect(order).toEqual(["a-in", "b-in", "b-out", "a-out"]);
    expect(innerRan).toBe(true);
    expect(seen[1]).toBe(seen[0]);
  });

  it("throws when a layer calls next() twice for one event, and runs the inner once", () => {
    let inners = 0;
    const double: PhaseMiddleware<S, P, O> = (_ctx, next) => {
      next();
      next();
    };
    const chain = makeChain({ layers: [double] });
    expect(() => chain.run({ kind: "enter" }, () => ++inners)).toThrow(
      "middleware[0] called next() twice for one enter event",
    );
    expect(inners).toBe(1);
  });

  it("throws when a layer returns a Promise instead of running synchronously", () => {
    const slow = async (_ctx: MiddlewareContext<S, P, O>, next: () => void) => {
      await Promise.resolve();
      next();
    };
    const chain = makeChain({ layers: [smuggle(slow)] });
    expect(() => chain.run({ kind: "enter" }, () => {})).toThrow(
      "middleware[0] returned a Promise; the middleware chain is synchronous",
    );
  });

  it("lets a layer see rejections recorded inside next()", () => {
    let rejections = 0;
    let redacted = 0;
    const seen: number[] = [];
    const mw: PhaseMiddleware<S, P, O> = (ctx, next) => {
      expect(ctx.rejectionCount).toBe(0);
      next();
      seen.push(ctx.rejectionCount, ctx.redactedRejectionCount);
    };
    const chain = makeChain({
      layers: [mw],
      rejectionCount: () => rejections,
      redactedRejectionCount: () => redacted,
    });
    chain.run(
      { kind: "action", actionType: "PING", senderId: "p2", payload: {}, filterLevel: "off" },
      () => {
        rejections = 2;
        redacted = 1;
      },
    );
    expect(seen).toEqual([2, 1]);
  });

  it("routes ctx.reject to the action's sender with its code, message and redaction flag", () => {
    const calls: Array<{
      senderId: string;
      actionType: string;
      code: ErrorCode;
      message: string;
      redactPayload?: boolean | undefined;
    }> = [];
    const veto: PhaseMiddleware<S, P, O> = (ctx) => {
      ctx.reject(ErrorCode.NOT_ALLOWED, "no pinging", { redactPayload: true });
    };
    const chain = makeChain({
      layers: [veto],
      reject: (senderId, actionType, code, message, redactPayload) =>
        calls.push({ senderId, actionType, code, message, redactPayload }),
    });
    chain.run(
      { kind: "action", actionType: "PING", senderId: "p2", payload: {}, filterLevel: "off" },
      () => {},
    );
    expect(calls).toEqual([
      {
        senderId: "p2",
        actionType: "PING",
        code: ErrorCode.NOT_ALLOWED,
        message: "no pinging",
        redactPayload: true,
      },
    ]);
  });

  it("throws when ctx.reject is used for a non-action event", () => {
    const veto: PhaseMiddleware<S, P, O> = (ctx) => {
      ctx.reject(ErrorCode.NOT_ALLOWED, "no");
    };
    const chain = makeChain({ layers: [veto] });
    expect(() => chain.run({ kind: "enter" }, () => {})).toThrow(
      "only available for action events",
    );
  });

  it("exposes the live tick count as ctx.ticks while ticking and omits it otherwise", () => {
    let liveTicks: number | undefined = 3;
    const seen: MiddlewareContext<S, P, O>[] = [];
    const mw: PhaseMiddleware<S, P, O> = (ctx) => {
      seen.push(ctx);
    };
    const chain = makeChain({ layers: [mw], ticks: () => liveTicks });
    chain.run({ kind: "enter" }, () => {});
    expect(seen[0]?.ticks).toBe(3);
    liveTicks = undefined;
    chain.run({ kind: "enter" }, () => {});
    expect("ticks" in (seen[1] ?? {})).toBe(false);
  });
});
