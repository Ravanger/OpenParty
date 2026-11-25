import type { RuntimeHost, TimerHandle } from "./host.js";

/** One timer the actor's clock is holding, paused or running. */
interface PendingTimer {
  callback: () => void;
  /** Epoch ms at which it fires while running; recomputed on every arm. */
  dueAt: number;
  /** Milliseconds left until it fires: the delay on arm, the remainder after a pause. */
  remainingMs: number;
  /** The host timer currently running it, or `undefined` while paused. */
  handle: TimerHandle | undefined;
}

/**
 * The XState actor's clock, with a pause. Pausing clears every pending host timer and remembers how
 * long each had left; resuming re-arms it for that remainder. The handle the actor holds stays the
 * same across a pause, so the actor's later `clearTimeout` still cancels the re-armed timer. Used
 * for the phase `after` timer, so a host pause freezes `onTimeout` as exactly as it freezes ticks.
 */
export class PausableClock {
  private readonly timers = new Map<number, PendingTimer>();
  private nextId = 1;

  constructor(private readonly host: RuntimeHost) {}

  /** {@inheritDoc RuntimeHost.setTimeout} */
  setTimeout(callback: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    const timer: PendingTimer = { callback, dueAt: 0, remainingMs: ms, handle: undefined };
    this.timers.set(id, timer);
    this.arm(id, timer);
    return id as TimerHandle;
  }

  /** {@inheritDoc RuntimeHost.clearTimeout} */
  clearTimeout(handle: TimerHandle): void {
    const id = handle as number;
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    if (timer.handle !== undefined) this.host.clearTimeout(timer.handle);
    this.timers.delete(id);
  }

  /** Freezes every pending timer at the current host time. */
  pause(): void {
    for (const timer of this.timers.values()) {
      if (timer.handle !== undefined) this.host.clearTimeout(timer.handle);
      timer.remainingMs = Math.max(0, timer.dueAt - this.host.now());
      timer.handle = undefined;
    }
  }

  /** Re-arms every paused timer for the remainder it had left. */
  resume(): void {
    for (const [id, timer] of this.timers) {
      if (timer.handle === undefined) this.arm(id, timer);
    }
  }

  private arm(id: number, timer: PendingTimer): void {
    timer.dueAt = this.host.now() + timer.remainingMs;
    timer.handle = this.host.setTimeout(() => {
      this.timers.delete(id);
      timer.callback();
    }, timer.remainingMs);
  }
}
