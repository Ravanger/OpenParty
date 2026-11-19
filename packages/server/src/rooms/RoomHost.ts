import type { Clock, Delayed } from "@colyseus/core";
import type { Schema } from "@colyseus/schema";
import {
  type ActionLog,
  AudienceScopes,
  type LogFields,
  type Logger,
  type PlayerInfo,
  type RuntimeHost,
  type Seed,
  type TimerHandle,
} from "@openparty/core";
import { CLIENT_MESSAGES, ErrorCode, ServerMessage } from "@openparty/shared";
import type { BaseGameState } from "@openparty/shared/schema";
import { type PlayerSchema, syncedJsonOf } from "@openparty/shared/schema";
import type { ReplayRecorder } from "./ReplayRecorder.js";
import type { SeatRegistry } from "./SeatRegistry.js";
import type { ViewRegistry } from "./ViewRegistry.js";

/** Everything the host adapter needs from its room. */
export interface RoomHostDeps {
  /** The room's synced state. */
  state: () => BaseGameState;
  /** Seat and spectator lookup for sends and kicks. */
  seats: SeatRegistry;
  /** Per-player view show/hide. */
  views: ViewRegistry;
  /** The room RNG seed, recorded in the action log header. */
  seed: Seed;
  /** The room's seeded PRNG. */
  rngFn: () => number;
  /** The room's Colyseus clock; owns every timer the runtime schedules. */
  clock: Clock;
  /** Sends one message to every client. */
  broadcast: (type: string, payload: unknown) => void;
  /** Records the transition snapshots the export assembles. */
  recorder: ReplayRecorder;
  /** The room's action log, if the game keeps one. */
  actionLog: () => ActionLog | undefined;
  /** One structured line for the room at `level`. */
  logLine: (level: "info" | "warn" | "error", event: string, fields?: LogFields) => void;
  /** Runs a hook, logging (and swallowing) any throw. */
  safely: (fn: () => void) => void;
  /** Removes a seat and its bookkeeping; `rememberSecret` keeps the secret for kicked-seat detection. */
  dropSeat: (playerId: string, rememberSecret: boolean) => void;
  /** Arms the empty-room disposal when no connected seat remains. */
  scheduleDisposeIfEmpty: () => void;
}

/**
 * The adapter between the Colyseus room and the core runtime: implements {@link RuntimeHost} over
 * the room's state, seat and view registries. Owns the timer table, the `audienceOnce` scopes and
 * the published options; records each transition through the room's {@link ReplayRecorder}.
 */
export class RoomHost implements RuntimeHost {
  /** TimerHandle ids handed out by the host, mapped to their Colyseus Delayed. */
  private readonly timerByHandle = new Map<number, Delayed>();
  private timerSeq = 0;
  /** Scopes each audience key has already used (`ctx.audience.once`); cleared on every transition. */
  private readonly audienceScopes = new AudienceScopes();
  /** The room's current parsed options; the host's `publishOptions` is its single writer. */
  private roomOptions: Record<string, unknown> = {};

  constructor(private readonly deps: RoomHostDeps) {
    this.seed = deps.seed;
  }

  /** The room RNG seed (see `sfc32`); recorded in the action log header. */
  readonly seed: Seed;

  /** The parsed options the host last published. */
  get options(): Record<string, unknown> {
    return this.roomOptions;
  }

  players(): PlayerInfo[] {
    return [...this.deps.state().players.values()].map((seat) => this.infoOf(seat));
  }

  activateWaitingPlayers(): void {
    for (const seat of this.deps.state().players.values()) if (seat.isReady) seat.isActive = true;
  }

  benchUnreadyPlayers(): void {
    for (const seat of this.deps.state().players.values()) if (!seat.isReady) seat.isActive = false;
  }

  send(playerId: string, type: string, payload: unknown): void {
    (this.deps.seats.clientFor(playerId) ?? this.deps.seats.spectatorClientFor(playerId))?.send(
      type,
      payload,
    );
  }

  broadcast(type: string, payload: unknown): void {
    this.deps.broadcast(type, payload);
  }

  notifyTransition(from: string, to: string): void {
    this.deps.safely(() => {
      // A bundle needs both halves: without an action log the snapshots could never be exported.
      if (this.deps.actionLog() !== undefined) {
        this.deps.recorder.record(from, to, syncedJsonOf(this.deps.state()));
      }
      this.audienceScopes.clear();
    });
  }

  audienceOnce(audienceKey: string, scope: string): boolean {
    return this.audienceScopes.once(audienceKey, scope);
  }

  showTo(playerId: string, ref: Schema): void {
    this.deps.views.show(playerId, ref);
  }

  hideFrom(playerId: string, ref: Schema): void {
    this.deps.views.hide(playerId, ref);
  }

  kick(playerId: string): void {
    this.deps.seats.markKicked(playerId);
    const client = this.deps.seats.clientFor(playerId);
    client?.send(ServerMessage.ERROR, { code: ErrorCode.KICKED, message: CLIENT_MESSAGES.KICKED });
    this.deps.dropSeat(playerId, true);
    this.deps.scheduleDisposeIfEmpty();
    client?.leave();
  }

  /** Sinks the room's log lines; the runtime routes `ctx.log` through it. */
  readonly log: Logger = {
    info: (event, fields) => this.deps.logLine("info", event, fields),
    warn: (event, fields) => this.deps.logLine("warn", event, fields),
    error: (event, fields) => this.deps.logLine("error", event, fields),
  };

  /** Arrow field: the runtime detaches `setHost` before calling it, so the receiver must be lexical. */
  setHost = (playerId: string): void => {
    for (const seat of this.deps.state().players.values()) {
      if (seat.id === playerId) seat.role = "host";
      else if (seat.role === "host") seat.role = "player";
    }
  };

  publishOptions(options: unknown): void {
    this.roomOptions = options as Record<string, unknown>;
    this.deps.state().options = JSON.stringify(options);
  }

  now(): number {
    return Date.now();
  }

  rng(): number {
    return this.deps.rngFn();
  }

  setTimeout(callback: () => void, ms: number): TimerHandle {
    const id = ++this.timerSeq;
    const delayed = this.deps.clock.setTimeout(() => {
      this.timerByHandle.delete(id);
      this.deps.safely(callback);
    }, ms);
    this.timerByHandle.set(id, delayed);
    return id as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timerByHandle.get(handle)?.clear();
    this.timerByHandle.delete(handle);
  }

  private infoOf(seat: PlayerSchema): PlayerInfo {
    return {
      id: seat.id,
      name: seat.name,
      role: seat.role,
      isConnected: seat.isConnected,
      isReady: seat.isReady,
      isActive: seat.isActive,
    };
  }
}
