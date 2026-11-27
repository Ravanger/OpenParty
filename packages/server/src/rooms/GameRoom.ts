import {
  type Client,
  CloseCode as ColyseusCloseCode,
  type Delayed,
  logger,
  Room,
  ServerError,
} from "@colyseus/core";
import type { TextFilter } from "@openparty/content/filter";
import {
  evaluateJoin,
  type GameDefinition,
  GameRuntime,
  getActionLog,
  type LogFields,
  type Logger,
  randomSeed,
  required,
  resolveGameOptions,
  type Seed,
  sfc32,
} from "@openparty/core";
import {
  CLIENT_MESSAGES,
  CLOSE_CODES,
  ClientMessage,
  type CloseCode,
  ErrorCode,
  FRAMEWORK_OPTION_KEYS,
  JoinOptionsSchema,
  LOBBY_PHASE,
  PROTOCOL_VERSION,
  type ServerError as ProtocolError,
  RoomOptionsSchema,
  ServerMessage,
} from "@openparty/shared";
import type { BaseGameState } from "@openparty/shared/schema";
import { PlayerSchema } from "@openparty/shared/schema";
import type { ZodError } from "zod";
import type { RateLimiter, ResolvedRateLimits } from "../RateLimiter.js";
import type { RoomCodeService } from "../services/RoomCodeService.js";
import { ActionRouter } from "./ActionRouter.js";
import { NamePolicy } from "./NamePolicy.js";
import { ReplayRecorder, type ReplaySnapshot } from "./ReplayRecorder.js";
import { RoomHost } from "./RoomHost.js";
import { SeatRegistry } from "./SeatRegistry.js";
import { ViewRegistry } from "./ViewRegistry.js";

const SPECTATOR_ERROR: ProtocolError = {
  code: ErrorCode.UNAUTHORIZED,
  message: CLIENT_MESSAGES.UNAUTHORIZED,
};

/** The per-game configuration `createGameServer` hands to each `GameRoom`; not built by game code. */
export interface GameRoomConfig {
  definition: GameDefinition<BaseGameState, unknown, unknown>;
  stateClass: new () => BaseGameState;
  roomCodeService: RoomCodeService;
  reconnectMs: number;
  emptyRoomGraceMs: number;
  /** Most phase transitions kept as replay snapshots; once the log outgrows them the export refuses. */
  maxReplayTransitions: number;
  /** Maximum concurrent rooms across all games; a create beyond it closes with `SERVER_FULL` (4429). */
  maxRooms: number;
  /** Spectator connections admitted on top of `maxPlayers`; the room's `maxClients`. */
  audienceSlots: number;
  /** When set, player names are checked against it at join and on `SET_NAME`. */
  textFilter?: TextFilter;
  /** How often Colyseus patches state to clients, in ms; omitted keeps the library default (50 ms, 20 Hz). */
  patchRateMs?: number;
  /** Shared per-player limiter; buckets are keyed `(roomId, playerId, messageType)` so a reconnect cannot reset them. */
  rateLimiter: RateLimiter;
  /** The resolved limits behind `rateLimiter`, one bucket per message type. */
  rateLimits: ResolvedRateLimits;
  /** Structured lifecycle logger; every line this room emits carries the room id. */
  logger: Logger;
}

/** Generic Colyseus room: seats, roster, reconnection and per-player views around a core `GameRuntime`. */
export class GameRoom extends Room<{ state: BaseGameState }> {
  private runtime!: GameRuntime<BaseGameState, unknown, unknown>;
  private emptyTimer: Delayed | undefined;
  /** Seat and spectator bookkeeping: session bindings, seat secrets, kicks. */
  private readonly seats = new SeatRegistry(() => this.clients);
  /** Per-session views and the private refs each player is shown. */
  private readonly views = new ViewRegistry((playerId) => this.seats.sessionIdFor(playerId));
  /** Per-room RNG seed drawn from the platform CSPRNG at room creation; recorded in action logs. */
  private readonly seed: Seed = randomSeed();
  /** Seeded PRNG so a room's randomness is reproducible from its log header. */
  private readonly rngFn = sfc32(this.seed);
  /** The runtime's room adapter: timers, audience-once scopes and the published options. */
  private host!: RoomHost;
  /** Routes ACTION and EXPORT_REPLAY: seat vs audience dispatch under the per-seat rate limits. */
  private router!: ActionRouter;
  /** The room's name policy: filter level, rejections and the uniqueness check, plus SET_NAME. */
  private names!: NamePolicy;
  private seatList: Set<string> | undefined;

  /** The replay snapshots recorded at each phase transition; filled and read by {@link ReplayRecorder}. */
  private readonly snapshots: ReplaySnapshot[] = [];

  /** Builds the Colyseus close `ServerError` for a {@link CLOSE_CODES} entry; the only place one is made. */
  private readonly closeWith = (entry: CloseCode, message?: string): ServerError =>
    new ServerError(entry.code, message ?? entry.message);

  /** Refuses a create/join whose protocolVersion is missing or different; fills the template from numbers only. */
  private readonly versionMismatch = (clientVersion?: number): ServerError => {
    const client = clientVersion === undefined ? "unknown" : String(clientVersion);
    return this.closeWith(
      CLOSE_CODES.VERSION_MISMATCH,
      CLOSE_CODES.VERSION_MISMATCH.message
        .replace("{client}", client)
        .replace("{server}", `${PROTOCOL_VERSION}`),
    );
  };

  constructor(private readonly config: GameRoomConfig) {
    super();
    if (config.patchRateMs !== undefined) this.patchRate = config.patchRateMs;
  }

  onCreate(options: Record<string, unknown>): void {
    try {
      this.create(options);
    } catch (error) {
      throw this.unexpected("create", error);
    }
  }

  onJoin(client: Client, options?: unknown): void {
    try {
      this.join(client, options);
    } catch (error) {
      throw this.unexpected("join", error);
    }
  }

  /** Close codes thrown by `closeWith` pass through; anything else is logged and becomes the fixed INTERNAL close. */
  private unexpected(phase: string, error: unknown): ServerError {
    if (error instanceof ServerError) return error;
    logger.error(`[GameRoom] ${phase} failed`, error);
    return this.closeWith(CLOSE_CODES.INTERNAL);
  }

  private invalidOptions(where: string, error: ZodError): ServerError {
    logger.warn(`[GameRoom] invalid ${where} options`, error.issues);
    return this.closeWith(CLOSE_CODES.INVALID_OPTIONS);
  }

  /**
   * Re-runs the game-options parse to recover its issues for the server-side log;
   * `resolveGameOptions` already refused these options, so the re-parse cannot succeed and this
   * always throws.
   */
  private invalidGameOptions(raw: Record<string, unknown>): never {
    const reparse = required(this.config.definition.options, "options schema").safeParse(raw);
    throw this.invalidOptions("create", (reparse as { error: ZodError }).error);
  }

  /** One structured line for this room at `level`; the room id is bound here and wins over caller fields. */
  private logLine(level: "info" | "warn" | "error", event: string, fields?: LogFields): void {
    this.config.logger[level](event, { ...(fields ?? {}), roomId: this.roomId });
  }

  private create(options: Record<string, unknown>): void {
    const { definition, stateClass, roomCodeService } = this.config;
    if (roomCodeService.size >= this.config.maxRooms) throw this.closeWith(CLOSE_CODES.SERVER_FULL);
    const roomOptions = RoomOptionsSchema.safeParse(options);
    if (!roomOptions.success) throw this.invalidOptions("create", roomOptions.error);
    if (roomOptions.data.protocolVersion !== PROTOCOL_VERSION) {
      throw this.versionMismatch(roomOptions.data.protocolVersion);
    }
    if (roomOptions.data.seats) {
      if (roomOptions.data.seats.length > definition.maxPlayers) {
        throw this.closeWith(CLOSE_CODES.INVALID_OPTIONS);
      }
      this.seatList = new Set(roomOptions.data.seats);
    }
    this.autoDispose = false;
    this.maxClients = definition.maxPlayers + this.config.audienceSlots;
    const rawOptions = Object.fromEntries(
      Object.entries(options).filter(([key]) => !FRAMEWORK_OPTION_KEYS.includes(key)),
    );
    const resolved = resolveGameOptions(definition, rawOptions);
    if (!resolved.ok) {
      if (resolved.reason === "invalid") throw this.invalidGameOptions(rawOptions);
      throw this.closeWith(CLOSE_CODES.INVALID_OPTIONS);
    }
    const parsedOptions = resolved.options;

    const recorder = new ReplayRecorder(
      definition,
      this.config.maxReplayTransitions,
      this.snapshots,
    );
    const host = new RoomHost({
      state: () => this.state,
      seats: this.seats,
      views: this.views,
      seed: this.seed,
      rngFn: this.rngFn,
      clock: this.clock,
      broadcast: (type, payload) => this.broadcast(type, payload),
      recorder,
      actionLog: () => getActionLog(this.runtime.priv),
      logLine: (level, event, fields) => this.logLine(level, event, fields),
      safely: (fn) => this.safely(fn),
      dropSeat: (playerId, rememberSecret) => this.dropSeat(playerId, rememberSecret),
      scheduleDisposeIfEmpty: () => this.scheduleDisposeIfEmpty(),
    });
    const router = new ActionRouter({
      seats: this.seats,
      seatBySession: (client) => this.seatBySession(client),
      phase: () => this.state.phase,
      phases: definition.phases,
      dispatch: (playerId, raw) => this.runtime.dispatch(playerId, raw),
      dispatchAudience: (playerId, raw) => this.runtime.dispatchAudience(playerId, raw),
      take: (key, bucket) => this.config.rateLimiter.take(key, bucket),
      drop: (prefix) => this.config.rateLimiter.drop(prefix),
      roomId: () => this.roomId,
      rateLimits: this.config.rateLimits,
      recorder,
      runtime: () => this.runtime,
      logLine: (level, event, fields) => this.logLine(level, event, fields),
    });
    const names = new NamePolicy({
      definition,
      textFilter: this.config.textFilter,
      options: () => host.options,
      players: () => this.state.players.values(),
      seatOf: (client) => this.seatOf(client),
      phase: () => this.state.phase,
      limited: (playerId, messageType, bucket) => router.limited(playerId, messageType, bucket),
      setNameBucket: this.config.rateLimits.setName,
      rosterChanged: () => this.rosterChanged(),
    });
    this.host = host;
    this.router = router;
    this.names = names;

    const code = roomCodeService.generateAndRegister(this.roomId);

    try {
      const state = new stateClass();
      state.minPlayers = definition.minPlayers;
      state.maxPlayers = definition.maxPlayers;
      state.serverNow = Date.now();
      state.roomCode = code;
      this.setState(state);
      host.publishOptions(parsedOptions);
      this.runtime = new GameRuntime({
        definition,
        state,
        options: parsedOptions,
        host,
      });
      this.clock.setInterval(() => {
        state.serverNow = Date.now();
      }, 1000);
      this.scheduleDisposeIfEmpty();

      this.onMessage(ClientMessage.SET_NAME, (client, raw: unknown) => this.names.set(client, raw));
      this.onMessage(ClientMessage.ACTION, (client, raw: unknown) =>
        this.router.action(client, raw),
      );
      this.onMessage(ClientMessage.EXPORT_REPLAY, (client) => this.router.exportReplay(client));
      this.logLine("info", "room.created");
    } catch (error) {
      roomCodeService.unregister(code);
      throw error;
    }
  }

  private join(client: Client, options?: unknown): void {
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success) throw this.invalidOptions("join", parsed.error);
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      throw this.versionMismatch(parsed.data.protocolVersion);
    }
    const { playerId, name, spectator, seatSecret } = parsed.data;
    if (this.seats.isKicked(playerId)) throw this.closeWith(CLOSE_CODES.KICKED_REJOIN);
    if (seatSecret !== undefined && this.seats.isKickedSecret(seatSecret)) {
      throw this.closeWith(CLOSE_CODES.KICKED_REJOIN);
    }
    if (!spectator && this.seatList && !this.seatList.has(playerId)) {
      throw this.closeWith(CLOSE_CODES.WATCH_ONLY);
    }
    // A rejoin of an already-seated player (a new session presenting the seat secret) skips the hook.
    if (!this.state.players.has(playerId)) {
      const verdict = evaluateJoin(this.config.definition, {
        playerId,
        ...(name === undefined ? {} : { name }),
        spectator: spectator === true,
        joinData: parsed.data.joinData ?? {},
        roster: this.host.players(),
      });
      if (!verdict.ok) throw this.closeWith(CLOSE_CODES.JOIN_REFUSED, verdict.message);
    }
    this.views.open(client);
    if (spectator) {
      // A spectator holding a seated id would receive that seat's private sends while the seat
      // has no live client (the drop window): refuse it (#325).
      if (this.state.players.has(playerId)) throw this.closeWith(CLOSE_CODES.SEAT_TAKEN);
      this.seats.addSpectator(client.sessionId, playerId);
      ++this.state.spectatorCount;
      return;
    }
    const existing = this.state.players.get(playerId);
    if (existing) {
      if (!seatSecret || !this.seats.secretMatches(playerId, seatSecret)) {
        throw this.closeWith(CLOSE_CODES.SEAT_TAKEN);
      }
      // Every refusal check passed: cancel only now, so a refused join keeps the empty-room
      // disposal armed (#324).
      this.cancelDispose();
      const oldClient = this.seats.bind(playerId, client.sessionId);
      this.reconnected(existing, client);
      oldClient?.leave(CLOSE_CODES.SEAT_TAKEN_OVER.code);
      return;
    }
    if (!seatSecret) throw this.closeWith(CLOSE_CODES.SEAT_TAKEN);
    if (this.state.players.size >= this.config.definition.maxPlayers) {
      throw this.closeWith(CLOSE_CODES.ROOM_FULL);
    }
    if (name && this.names.rejected(name) !== undefined) {
      throw this.closeWith(CLOSE_CODES.CONTENT_REJECTED);
    }
    // Every refusal check passed: cancel only now, so a refused join keeps the empty-room
    // disposal armed (#324).
    this.cancelDispose();
    // A spectator may hold this id (it joined while the seat was free): seating takes the id
    // away for good, so evict it with the same close code (#325). Iterate a snapshot: leave()
    // closes the socket and the client leaves this.clients only when that close is processed.
    for (const client of [...this.clients]) {
      if (this.seats.spectatorPlayerIdFor(client.sessionId) === playerId) {
        client.leave(CLOSE_CODES.SEAT_TAKEN.code);
      }
    }
    const seat = new PlayerSchema();
    seat.id = playerId;
    seat.name = name && !this.names.taken(playerId, name) ? name : "";
    seat.isActive = this.state.phase === LOBBY_PHASE;
    // The first seat is host by acquisition (as in FakeHost); `hostMigration` only governs handover.
    if (this.state.players.size === 0) seat.role = "host";
    this.state.players.set(playerId, seat);
    this.seats.storeSecret(playerId, seatSecret);
    this.seats.bind(playerId, client.sessionId);
    this.rosterChanged();
    this.logLine("info", "player.joined", { playerId });
  }

  async onDrop(client: Client): Promise<void> {
    const seat = this.seatBySession(client);
    if (!seat) return;
    seat.isConnected = false;
    this.rosterChanged();
    this.scheduleDisposeIfEmpty();
    await this.allowReconnection(client, this.config.reconnectMs / 1000).catch(() => undefined);
  }

  onReconnect(client: Client): void {
    const seat = this.seatBySession(client);
    if (!seat) throw this.closeWith(CLOSE_CODES.SEAT_REMOVED);
    this.cancelDispose();
    this.reconnected(seat, client);
  }

  onLeave(client: Client, code?: number): void {
    this.views.close(client.sessionId);
    const spectatorId = this.seats.spectatorPlayerIdFor(client.sessionId);
    if (spectatorId !== undefined) {
      this.seats.removeSpectator(client.sessionId);
      --this.state.spectatorCount;
      this.forgetAudience(spectatorId, code === ColyseusCloseCode.CONSENTED);
      return;
    }
    const seat = this.seatBySession(client);
    if (seat) {
      this.removeSeat(seat.id);
      this.logLine("info", "player.left", { playerId: seat.id });
    }
  }

  onDispose(): void {
    this.runtime?.stop();
    if (this.state?.roomCode) this.config.roomCodeService.unregister(this.state.roomCode);
    this.config.rateLimiter.drop(`${this.roomId}:`);
    this.logLine("info", "room.disposed");
  }

  /** The seat of the session behind `client`, if any. */
  private seatBySession(client: Client): PlayerSchema | undefined {
    return this.state.players.get(this.seats.playerIdFor(client.sessionId) ?? "");
  }

  private seatOf(client: Client): PlayerSchema | undefined {
    const seat = this.seatBySession(client);
    if (!seat) client.send(ServerMessage.ERROR, SPECTATOR_ERROR);
    return seat;
  }

  private reconnected(seat: PlayerSchema, client: Client): void {
    seat.isConnected = true;
    this.views.restore(seat.id, client);
    this.safely(() => this.runtime.syncPlayer(seat.id));
    this.rosterChanged();
    this.logLine("info", "player.reconnected", { playerId: seat.id });
  }

  private dropSeat(playerId: string, rememberSecret: boolean): void {
    this.seats.forgetSecret(playerId, rememberSecret);
    this.state.players.delete(playerId);
    this.views.forget(playerId);
    this.seats.unbind(playerId);
    this.config.rateLimiter.drop(`${this.roomId}:${playerId}:`);
  }

  private removeSeat(playerId: string): void {
    this.dropSeat(playerId, false);
    this.rosterChanged();
    this.scheduleDisposeIfEmpty();
  }

  /**
   * Forgets a departed spectator's audience buckets. A consented leave is final, so it drops them
   * at once; an abnormal drop waits out the seat reconnection window, because a spectator that
   * comes back under the same join `playerId` must not get a fresh bucket.
   */
  private forgetAudience(playerId: string, consented: boolean): void {
    if (consented) {
      this.router.dropAudience(playerId);
      return;
    }
    this.clock.setTimeout(() => {
      if (this.seats.spectatorClientFor(playerId) === undefined) this.router.dropAudience(playerId);
    }, this.config.reconnectMs);
  }

  private rosterChanged(): void {
    this.safely(() => this.runtime.rosterChanged());
  }

  private scheduleDisposeIfEmpty(): void {
    const occupied = [...this.state.players.values()].some((seat) => seat.isConnected);
    if (occupied || this.emptyTimer) return;
    this.emptyTimer = this.clock.setTimeout(
      () => void this.disconnect(),
      this.config.emptyRoomGraceMs,
    );
  }

  private cancelDispose(): void {
    this.emptyTimer?.clear();
    this.emptyTimer = undefined;
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      logger.error("[GameRoom] hook failed", error);
    }
  }
}
