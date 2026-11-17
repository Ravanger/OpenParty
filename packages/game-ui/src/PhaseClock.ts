import type { Countdown, GameConnectionManager } from "@openparty/game-client";
import type { BaseGameState } from "@openparty/shared/schema";
import { getStrings } from "./strings.js";

const ANNOUNCE_AT = [30, 10, 5];

/** The server's countdown of the current phase, plus how long that phase was set to run. */
export class PhaseClock {
  private readonly countdown: Countdown;

  constructor(
    private readonly manager: GameConnectionManager<BaseGameState>,
    private readonly announceAt: readonly number[] = ANNOUNCE_AT,
  ) {
    this.countdown = manager.countdown();
  }

  /** Whole seconds left in the phase, on the server's clock. */
  get secondsLeft(): number {
    return this.countdown.secondsLeft;
  }

  /** True in the last ten seconds of the phase. */
  get isUrgent(): boolean {
    return this.countdown.isUrgent;
  }

  /** The table's `secondsRemaining` text at the announcement thresholds, otherwise "". */
  get announcement(): string {
    const left = this.secondsLeft;
    return this.announceAt.includes(left) ? getStrings().secondsRemaining(left) : "";
  }

  /**
   * How long the phase was set to run, in whole seconds, from the synced `phaseDurationMs`. When
   * the server published no length (0), the current `secondsLeft` instead — so the bar shows full
   * and nothing divides by zero.
   */
  get totalSeconds(): number {
    const durationMs = this.manager.state?.phaseDurationMs ?? 0;
    return durationMs > 0 ? Math.ceil(durationMs / 1000) : this.secondsLeft;
  }

  /** The share of the phase still running, from 0 to 1; 0 when the phase has no length. */
  get fraction(): number {
    const total = this.totalSeconds;
    return total > 0 ? Math.min(1, Math.max(0, this.secondsLeft / total)) : 0;
  }
}
