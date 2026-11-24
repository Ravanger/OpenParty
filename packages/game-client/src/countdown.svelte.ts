import { createSubscriber } from "svelte/reactivity";
import { ServerClock } from "./serverClock.js";

const DEFAULT_TICK_MS = 250;

/** The last-stretch length of a countdown, in whole seconds. */
export const URGENT_SECONDS = 10;

/** Whether a countdown is in its last stretch: more than 0 seconds left and at most {@link URGENT_SECONDS}, so an expired timer (0) is not urgent. */
export function isUrgentSeconds(secondsLeft: number): boolean {
  return secondsLeft > 0 && secondsLeft <= URGENT_SECONDS;
}

/**
 * The package's public name for {@link isUrgentSeconds}; existing imports keep working.
 * @alias isUrgentSeconds — kept so the public API and export snapshot stay unchanged (knip: an intentional alias).
 */
export const isUrgent = isUrgentSeconds;

/** Seconds left until a server-set deadline, corrected for client clock skew, with `isExpired` and `isUrgent` flags. */
export class Countdown {
  private readonly clock = new ServerClock();
  readonly isExpired: boolean = $derived(this.secondsLeft <= 0);
  readonly isUrgent: boolean = $derived(isUrgentSeconds(this.secondsLeft));
  private readonly track: () => void;

  constructor(
    private readonly getEndsAt: () => number,
    private readonly getServerNowFn: () => number,
    tickMs = DEFAULT_TICK_MS,
  ) {
    this.sync();
    this.track = createSubscriber((update) => {
      const interval = setInterval(() => {
        this.sync();
        update();
      }, tickMs);
      return () => clearInterval(interval);
    });
  }

  /** Whole seconds left, skew-corrected against the server clock; `0` when no timer is set or no server time has arrived. */
  get secondsLeft(): number {
    this.track();
    this.sync();
    const ends = this.getEndsAt();
    if (!ends || !this.clock.isSynced) return 0;
    return Math.max(0, Math.ceil((ends - this.clock.now()) / 1000));
  }

  /** Re-anchors the clock to the newest server time, if it changed. */
  private sync(): void {
    this.clock.observe(this.getServerNowFn());
  }
}
