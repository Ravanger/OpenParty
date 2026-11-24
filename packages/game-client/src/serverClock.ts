import type { BaseGameState } from "@openparty/shared/schema";
import type { RoomLike } from "./RoomLike.js";

/** How often the clock resamples the round-trip time while it is being read, in ms. */
const SAMPLE_MS = 30_000;

/**
 * An estimate of the server's current time, built from the `serverNow` the server writes to
 * state. Every new reading anchors the offset, counting half the measured round-trip time as the
 * one-way delay of that reading; between readings `now()` advances with the local clock. A
 * reading that is not newer is ignored, so the estimate never moves backwards. Before any
 * reading it falls back to local time.
 *
 * Attach one to a room to start observing and to measure the round-trip time on join and, while
 * the clock is read, every 30 seconds; detach it when the room goes away.
 * `GameConnectionManager.clock` is already wired.
 *
 * @experimental Real-time client API; may change before 1.0.
 */
export class ServerClock<TState extends BaseGameState = BaseGameState> {
  private offsetMs = 0;
  private rttMs = 0;
  private synced = false;
  private lastObserved = 0;
  private lastNow = 0;
  private room: RoomLike<TState> | undefined;
  private lastPingAt = 0;
  private offStateChange: (() => void) | undefined;

  /** Whether at least one server time has been observed, so `now()` is no longer local time. */
  get isSynced(): boolean {
    return this.synced;
  }

  /** Observes the room's `serverNow` and measures the round-trip time on join. */
  attach(room: RoomLike<TState>): void {
    this.detach();
    this.room = room;
    const callback = (): void => this.observeRoom(room);
    room.onStateChange(callback);
    this.offStateChange = () => room.onStateChange.remove(callback);
    this.observeRoom(room);
    this.sample(room);
  }

  /** Stops observing and sampling; the last offset stays until a new room anchors a reading. */
  detach(): void {
    if (this.offStateChange !== undefined) this.offStateChange();
    this.offStateChange = undefined;
    this.room = undefined;
    this.lastObserved = 0;
  }

  /**
   * Folds one `serverNow` reading into the offset, treating half `rttMs` as the one-way delay of
   * the reading. A non-positive or repeated reading is ignored.
   */
  observe(serverNow: number, rttMs = this.rttMs): void {
    if (serverNow <= 0 || serverNow === this.lastObserved) return;
    this.lastObserved = serverNow;
    this.offsetMs = serverNow + rttMs / 2 - Date.now();
    this.synced = true;
  }

  /**
   * The estimated server time in ms: local time plus the last offset, or local time before the
   * first reading. It never returns less than the previous call.
   */
  now(): number {
    this.resample();
    const estimate = this.synced ? Date.now() + this.offsetMs : Date.now();
    const value = Math.max(estimate, this.lastNow);
    this.lastNow = value;
    return value;
  }

  private observeRoom(room: RoomLike<TState>): void {
    this.observe(room.state.serverNow);
  }

  private resample(): void {
    const room = this.room;
    if (room === undefined) return;
    if (Date.now() - this.lastPingAt < SAMPLE_MS) return;
    this.sample(room);
  }

  private sample(room: RoomLike<TState>): void {
    this.lastPingAt = Date.now();
    room.ping((rttMs) => {
      this.rttMs = rttMs;
    });
  }
}
