import type { RuntimeHost, TimerHandle } from "./host.js";
import type { GameContext, PhaseDefinition, PhaseState } from "./types.js";

/** `PhaseDefinition.tickMs` when a ticking phase does not set one: 10 Hz. */
const DEFAULT_TICK_MS = 100;

/** What the ticker needs from the runtime: the host clock, step execution and the game context. */
export interface PhaseTickerDeps<TState extends PhaseState, TPrivate, TOptions> {
  readonly host: RuntimeHost;
  /** Runs one fired tick as a full runtime step. */
  run(fn: () => void): void;
  /** Builds the context handed to `onTick`. */
  context(): GameContext<TState, TPrivate, TOptions>;
}

/**
 * The pending `onTick` timer of the current phase. `start(phase)` arms the first tick one
 * interval after entry; each fired tick reschedules the next anchored to the entry time, so tick
 * k is due at enter + k·tickMs and a late delivery is not carried into the next tick (#327).
 * Every fired tick increments {@link PhaseTicker.count}, which middleware see as `ctx.ticks` so
 * the action log can record it and replay can cap tick delivery at the live count (#246). Ticks
 * stop when the phase is left: every transition and `stop()` clears the pending timer, including
 * one scheduled by a tick that itself queued the transition.
 */
export class PhaseTicker<TState extends PhaseState, TPrivate, TOptions> {
  private readonly host: RuntimeHost;
  private readonly run: (fn: () => void) => void;
  private readonly context: () => GameContext<TState, TPrivate, TOptions>;
  private handle: TimerHandle | undefined = undefined;
  /** Ticks fired since entry into the current phase, while it has `onTick`. */
  private ticks = 0;

  constructor(deps: PhaseTickerDeps<TState, TPrivate, TOptions>) {
    this.host = deps.host;
    this.run = deps.run;
    this.context = deps.context;
  }

  /** Ticks fired since entry into the current phase. */
  get count(): number {
    return this.ticks;
  }

  /** Cancels the pending `onTick` timer, if the current phase has one. */
  clear(): void {
    if (this.handle === undefined) return;
    this.host.clearTimeout(this.handle);
    this.handle = undefined;
  }

  /** Cancels the pending timer and zeroes the count: a new phase entry. */
  reset(): void {
    this.clear();
    this.ticks = 0;
  }

  /** Arms the first `onTick` of a ticking phase, one interval after entry; does nothing without `onTick`. */
  start(phase: PhaseDefinition<TState, TPrivate, TOptions>): void {
    const onTick = phase.onTick;
    if (onTick === undefined) return;
    const dtMs = phase.tickMs ?? DEFAULT_TICK_MS;
    const enterAt = this.host.now();
    const step = (): void => {
      this.run(() => {
        onTick(this.context(), dtMs);
        ++this.ticks;
        this.handle = this.host.setTimeout(
          step,
          Math.max(0, enterAt + (this.ticks + 1) * dtMs - this.host.now()),
        );
      });
    };
    this.handle = this.host.setTimeout(step, dtMs);
  }
}
