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
 * `pause()` clears the pending timer and keeps how long it had left; `resume()` re-anchors the
 * cadence so that remainder is what runs next, and the ticks after it keep the same interval.
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
  /** Fires one tick and schedules the next; `undefined` without `onTick`. */
  private step: (() => void) | undefined = undefined;
  /** Epoch ms the cadence counts from; moved forward by each pause's remainder on resume. */
  private anchor = 0;
  private intervalMs = 0;
  /** Milliseconds left until the pending tick while {@link PhaseTicker.paused}. */
  private remainingMs = 0;
  private paused = false;
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
    this.step = undefined;
    this.paused = false;
    this.remainingMs = 0;
    this.ticks = 0;
  }

  /** Arms the first `onTick` of a ticking phase, one interval after entry; does nothing without `onTick`. */
  start(phase: PhaseDefinition<TState, TPrivate, TOptions>): void {
    const onTick = phase.onTick;
    if (onTick === undefined) return;
    this.intervalMs = phase.tickMs ?? DEFAULT_TICK_MS;
    this.anchor = this.host.now();
    this.paused = false;
    this.remainingMs = 0;
    const step = (): void => {
      this.run(() => {
        onTick(this.context(), this.intervalMs);
        ++this.ticks;
        this.arm(step, this.nextDue() - this.host.now());
      });
    };
    this.step = step;
    this.arm(step, this.intervalMs);
  }

  /** Stops the pending tick and remembers how long it had left; a no-op without `onTick` or already paused. */
  pause(): void {
    if (this.step === undefined || this.paused) return;
    this.paused = true;
    this.remainingMs = Math.max(0, this.nextDue() - this.host.now());
    this.clear();
  }

  /** Re-arms the paused tick for its remainder, continuing the cadence from the resume; otherwise a no-op. */
  resume(): void {
    const step = this.step;
    if (step === undefined || !this.paused) return;
    const remainingMs = this.remainingMs;
    this.paused = false;
    this.remainingMs = 0;
    this.anchor = this.host.now() + remainingMs - (this.ticks + 1) * this.intervalMs;
    this.handle = this.host.setTimeout(step, remainingMs);
  }

  /** The epoch ms at which the next tick is due on the current anchor. */
  private nextDue(): number {
    return this.anchor + (this.ticks + 1) * this.intervalMs;
  }

  /** Schedules the next step. */
  private arm(step: () => void, delayMs: number): void {
    this.handle = this.host.setTimeout(step, Math.max(0, delayMs));
  }
}
