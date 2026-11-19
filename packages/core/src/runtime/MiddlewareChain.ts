import type { ErrorCode } from "@openparty/shared";
import type {
  GameContext,
  MiddlewareContext,
  MiddlewareEvent,
  PhaseMiddleware,
  PhaseState,
  RejectOptions,
} from "./types.js";

/** The live values the chain reads into each event's context; the runtime owns the storage. */
export interface MiddlewareChainDeps<TState extends PhaseState, TPrivate, TOptions> {
  /** The definition's middleware layers, outermost first. */
  readonly layers: readonly PhaseMiddleware<TState, TPrivate, TOptions>[];
  /** Builds the base game context the event context is spread over. */
  context(): GameContext<TState, TPrivate, TOptions>;
  /** Rejections recorded since this dispatch started (live). */
  rejectionCount(): number;
  /** The redacted subset of {@link MiddlewareChainDeps.rejectionCount} (live). */
  redactedRejectionCount(): number;
  /** Ticks fired since the phase entry while a ticking phase is active, else undefined. */
  ticks(): number | undefined;
  /** Sends the middleware's `ctx.reject` to the action's sender, counted like any rejection. */
  reject(
    senderId: string,
    actionType: string,
    code: ErrorCode,
    message: string,
    redactPayload?: boolean,
  ): void;
}

/**
 * The Koa-style onion around phase hooks and action handlers: first registered layer runs
 * outermost. Synchronous — a layer that returns a Promise throws. Each layer's `next()` may be
 * called at most once per event; omitting it skips everything inside. The event context is built
 * once per event and shared by every layer, with the rejection counters read live through it.
 */
export class MiddlewareChain<TState extends PhaseState, TPrivate, TOptions> {
  constructor(private readonly deps: MiddlewareChainDeps<TState, TPrivate, TOptions>) {}

  /** Runs `inner` through the middleware onion; outermost first. */
  run(event: MiddlewareEvent, inner: () => void): void {
    if (this.deps.layers.length === 0) {
      inner();
      return;
    }
    const context = this.middlewareContext(event);
    const layers = this.deps.layers;
    const runLayer = (index: number): void => {
      const layer = layers[index];
      if (layer === undefined) {
        inner();
        return;
      }
      let nexted = false;
      const result: unknown = layer(context, () => {
        if (nexted) {
          throw new Error(`middleware[${index}] called next() twice for one ${event.kind} event`);
        }
        nexted = true;
        runLayer(index + 1);
      });
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        throw new Error(
          `middleware[${index}] returned a Promise; the middleware chain is synchronous`,
        );
      }
    };
    runLayer(0);
  }

  /** The event context: the base game context plus the live counters, `event` and `ctx.reject`. */
  private middlewareContext(event: MiddlewareEvent): MiddlewareContext<TState, TPrivate, TOptions> {
    const deps = this.deps;
    const ticks = deps.ticks();
    // A getter shorthand binds `this` to the context object, not the chain.
    return {
      ...deps.context(),
      ...(ticks !== undefined ? { ticks } : {}),
      event,
      get rejectionCount() {
        return deps.rejectionCount();
      },
      get redactedRejectionCount() {
        return deps.redactedRejectionCount();
      },
      reject: (code, message, options) => this.reject(event, code, message, options),
    };
  }

  /** Middleware rejections target the action's sender; other event kinds have no one to tell. */
  private reject(
    event: MiddlewareEvent,
    code: ErrorCode,
    message: string,
    options?: RejectOptions,
  ): void {
    if (event.kind !== "action")
      throw new Error("ctx.reject() is only available for action events");
    this.deps.reject(event.senderId, event.actionType, code, message, options?.redactPayload);
  }
}
