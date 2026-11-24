import type { BaseGameState } from "@openparty/shared/schema";
import { isUrgentSeconds } from "./countdown.svelte.js";
import type { FeedbackBus } from "./FeedbackBus.js";
import type { RoomLike } from "./RoomLike.js";
import { ServerClock } from "./serverClock.js";

const URGENCY_TICK_MS = 250;

/**
 * The manager's sound and animation event source: it watches the connected room's phase and
 * the countdown urgency and feeds them to a `FeedbackBus`. The watchers run only while at least
 * one `phase` or `urgent` listener is subscribed; the first observation after (re)starting is
 * the silent baseline, so a late subscriber only sees transitions it actually observed.
 */
export class StateFeedback<TState extends BaseGameState = BaseGameState> {
  private lastPhase: string | undefined;
  private phaseWatcher: { room: RoomLike<TState>; callback: () => void } | undefined;
  private urgencyTimer: ReturnType<typeof setInterval> | undefined;
  private urgentFired = false;
  private readonly offChange: () => void;

  constructor(
    private readonly feedback: FeedbackBus,
    private readonly roomOf: () => RoomLike<TState> | undefined,
    private readonly clock: ServerClock<TState> = new ServerClock(),
  ) {
    this.offChange = this.feedback.onChange(() => this.sync());
  }

  /** Starts the phase watcher and urgency timer when someone listens for `phase` or `urgent` events, and stops them when the last such listener leaves. The first observation after starting is the silent baseline, so a late subscriber only sees transitions it actually observed. */
  sync(): void {
    const room = this.roomOf();
    if (room === undefined) return;
    if (!this.feedback.hasListeners("phase") && !this.feedback.hasListeners("urgent")) {
      this.stop();
      return;
    }
    if (this.phaseWatcher !== undefined) return;
    const watchPhase = () => this.observePhase(room);
    room.onStateChange(watchPhase);
    this.phaseWatcher = { room, callback: watchPhase };
    this.startUrgencyTimer(room);
    watchPhase();
  }

  /** Stops the phase watcher and urgency timer and resets the phase baseline so a later (re)start re-establishes it silently. */
  stop(): void {
    this.phaseWatcher?.room.onStateChange.remove(this.phaseWatcher.callback);
    this.phaseWatcher = undefined;
    this.lastPhase = undefined;
    this.stopUrgencyTimer();
  }

  /** Stops everything and leaves the bus's change feed; the manager calls it on dispose. */
  dispose(): void {
    this.stop();
    this.offChange();
  }

  /** Emits a phase event when `state.phase` changes; the first observation after connecting is the silent baseline. */
  private observePhase(room: RoomLike<TState>): void {
    const phase = room.state.phase;
    const from = this.lastPhase;
    this.lastPhase = phase;
    if (from === undefined || from === phase) return;
    this.urgentFired = false;
    this.feedback.emitPhase(from, phase);
  }

  private startUrgencyTimer(room: RoomLike<TState>): void {
    this.stopUrgencyTimer();
    this.urgentFired = false;
    this.urgencyTimer = setInterval(() => this.observeUrgency(room), URGENCY_TICK_MS);
  }

  private stopUrgencyTimer(): void {
    if (this.urgencyTimer !== undefined) clearInterval(this.urgencyTimer);
    this.urgencyTimer = undefined;
  }

  /** Fires the once-per-phase urgent event while the phase's countdown is in its last ten seconds, on the shared server clock. */
  private observeUrgency(room: RoomLike<TState>): void {
    const state = room.state;
    this.clock.observe(state.serverNow);
    const ends = state.phaseEndsAt;
    if (!ends || !this.clock.isSynced) return;
    const remainingMs = ends - this.clock.now();
    if (!this.urgentFired && isUrgentSeconds(Math.ceil(remainingMs / 1000))) {
      this.urgentFired = true;
      this.feedback.emitUrgent();
    }
  }
}
