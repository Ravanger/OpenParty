import { type Client, logger } from "@colyseus/core";
import type { GameRuntime, LogFields } from "@openparty/core";
import {
  ActionEnvelopeSchema,
  type ActionResult,
  CLIENT_MESSAGES,
  ClientMessage,
  ErrorCode,
  type ServerError as ProtocolError,
  ServerMessage,
} from "@openparty/shared";
import type { BaseGameState, PlayerSchema } from "@openparty/shared/schema";
import type { ResolvedRateLimits, TokenBucket } from "../RateLimiter.js";
import type { ReplayRecorder } from "./ReplayRecorder.js";
import type { SeatRegistry } from "./SeatRegistry.js";

/** The slice of a phase's action table the router reads: which actions exist, who may send them and their own bucket. */
export interface RoutedPhase {
  /** The phase's actions, keyed by wire name. */
  readonly actions?: Record<
    string,
    { readonly from: "host" | "player" | "audience"; readonly rateLimit?: TokenBucket }
  >;
}

/** One action the current phase declares, with the wire name that keyed it. */
interface ResolvedAction {
  readonly type: string;
  readonly from: "host" | "player" | "audience";
  readonly rateLimit?: TokenBucket;
}

/**
 * Namespace that keeps an audience bucket apart from a seat's bucket for the same id, so a
 * spectator evicted by a seat can never wipe the new seat's budget when its own keys are dropped.
 */
const AUDIENCE_KEY = "audience";

/** Everything the router needs from its room; every lookup is a callback so fakes stay trivial. */
export interface ActionRouterDeps {
  /** The seat and spectator tables (the audience path keys votes by the spectator's join id). */
  seats: SeatRegistry;
  /** The seat of the session behind `client`, if any. */
  seatBySession: (client: Client) => PlayerSchema | undefined;
  /** The room's current phase name. */
  phase: () => string;
  /** The definition's phases, for the audience `from` check. */
  phases: Record<string, RoutedPhase>;
  /** Dispatches a seated player's action; returns the runtime's rejection, if any. */
  dispatch: (playerId: string, raw: unknown) => ProtocolError | undefined;
  /** Dispatches a seatless audience action; returns the runtime's rejection, if any. */
  dispatchAudience: (playerId: string, raw: unknown) => ProtocolError | undefined;
  /** Takes one token from `key`'s bucket; false only when exhausted in enforce mode. */
  take: (key: string, bucket: TokenBucket) => boolean;
  /** Forgets every bucket whose key starts with `prefix` (a spectator that left for good). */
  drop: (prefix: string) => void;
  /** The room id; prefixes every rate-limit bucket key. */
  roomId: () => string;
  /** The resolved per-message limits. */
  rateLimits: ResolvedRateLimits;
  /** The room's replay recorder; the export is host-only and the bundle build lives there. */
  recorder: ReplayRecorder;
  /** The room's runtime; handed to the recorder for its action log. */
  runtime: () => GameRuntime<BaseGameState, unknown, unknown>;
  /** One structured line for the room at `level`. */
  logLine: (level: "info" | "warn" | "error", event: string, fields?: LogFields) => void;
}

/**
 * Routes the room's ACTION and EXPORT_REPLAY messages: a seated connection dispatches under its
 * per-seat bucket, a seatless one only an action declared `from: "audience"` in the current phase,
 * and a thrown dispatch answers the fixed INTERNAL failure. The envelope is parsed before any
 * bucket is spent, so an action that declares its own `rateLimit` gets a bucket keyed by its type;
 * everything else — a malformed envelope, an undeclared type, a seatless sender of a seat action —
 * falls back to the shared bucket so unknown types cannot each mint one.
 */
export class ActionRouter {
  /** The fixed refusal for over-limit traffic. */
  private readonly rateLimited: ProtocolError = {
    code: ErrorCode.RATE_LIMITED,
    message: CLIENT_MESSAGES.RATE_LIMITED,
  };
  /** The fixed refusal for a seatless connection with nothing it may do. */
  private readonly spectator: ProtocolError = {
    code: ErrorCode.UNAUTHORIZED,
    message: CLIENT_MESSAGES.UNAUTHORIZED,
  };

  constructor(private readonly deps: ActionRouterDeps) {}

  /** Takes one token from `playerId`'s bucket for `messageType`; false when refused in enforce mode. */
  limited(playerId: string, messageType: string, bucket: TokenBucket): boolean {
    return this.deps.take(`${this.deps.roomId()}:${playerId}:${messageType}`, bucket);
  }

  /** Forgets every audience bucket the spectator `playerId` held (called once the seatless id is gone for good). */
  dropAudience(playerId: string): void {
    this.deps.drop(`${this.deps.roomId()}:${playerId}:${AUDIENCE_KEY}:`);
  }

  /**
   * Takes one token for one client action: its own bucket when the current phase declares a
   * `rateLimit` for it (keyed by action type, so a fast action does not spend the shared budget),
   * else the shared per-player action bucket. A seat is keyed by playerId; an audience sender by
   * the spectator's join playerId under {@link AUDIENCE_KEY}.
   */
  private spend(
    sender: string,
    action: ResolvedAction | undefined,
    scope: "seat" | "audience",
  ): boolean {
    const messageType =
      scope === "audience" ? `${AUDIENCE_KEY}:${ClientMessage.ACTION}` : ClientMessage.ACTION;
    if (action?.rateLimit === undefined) {
      return this.limited(sender, messageType, this.deps.rateLimits.action);
    }
    return this.limited(sender, `${messageType}:${action.type}`, action.rateLimit);
  }

  /** The ACTION message handler: a seat dispatches, a seatless connection takes the audience path. */
  action(client: Client, raw: unknown): ActionResult {
    const seat = this.deps.seatBySession(client);
    if (!seat) return this.actAudience(client, raw);
    if (!this.spend(seat.id, this.resolvedAction(raw), "seat")) {
      client.send(ServerMessage.ERROR, this.rateLimited);
      return { ok: false, error: this.rateLimited };
    }
    return this.runAction(raw, "action", () => this.deps.dispatch(seat.id, raw));
  }

  /** The EXPORT_REPLAY message handler; only a host seat spends the export bucket. */
  exportReplay(client: Client): unknown {
    const seat = this.deps.seatBySession(client);
    if (
      seat?.role === "host" &&
      !this.limited(seat.id, ClientMessage.EXPORT_REPLAY, this.deps.rateLimits.exportReplay)
    ) {
      client.send(ServerMessage.ERROR, this.rateLimited);
      return { ok: false, error: this.rateLimited };
    }
    return this.deps.recorder.export(this.deps.runtime(), seat);
  }

  /**
   * An ACTION from a seatless connection: the bucket is spent first (so a hostile display cannot
   * probe for free), then only an action declared `from: "audience"` in the current phase is
   * dispatched — under the spectator's join `playerId`, so a rejoin cannot reset it; everything
   * else gets the spectator error.
   */
  private actAudience(client: Client, raw: unknown): ActionResult {
    const playerId = this.deps.seats.spectatorPlayerIdFor(client.sessionId);
    const action = this.resolvedAction(raw);
    // Only an audience-declared action earns its own bucket here; a seat action would be refused below.
    const audienceAction = action?.from === "audience" ? action : undefined;
    if (!this.spend(playerId ?? client.sessionId, audienceAction, "audience")) {
      client.send(ServerMessage.ERROR, this.rateLimited);
      return { ok: false, error: this.rateLimited };
    }
    if (playerId === undefined || audienceAction === undefined) {
      client.send(ServerMessage.ERROR, this.spectator);
      return { ok: false, error: this.spectator };
    }
    return this.runAction(raw, "audience action", () => this.deps.dispatchAudience(playerId, raw));
  }

  /** The action `raw` names in the current phase, or `undefined` when it does not parse or is not declared. */
  private resolvedAction(raw: unknown): ResolvedAction | undefined {
    const type = this.actionTypeOf(raw);
    if (type === undefined) return undefined;
    const action = this.deps.phases[this.deps.phase()]?.actions?.[type];
    return action === undefined ? undefined : { ...action, type };
  }

  /** The type of a client action envelope, or `undefined` when it does not parse. */
  private actionTypeOf(raw: unknown): string | undefined {
    const envelope = ActionEnvelopeSchema.safeParse(raw);
    return envelope.success ? envelope.data.type : undefined;
  }

  /** Logs a runtime-rejected action (code and type only — never the payload) and returns the rejection. */
  private rejected(raw: unknown, error: ProtocolError): ActionResult {
    this.deps.logLine("warn", "action.rejected", {
      code: error.code,
      action: this.actionTypeOf(raw) ?? "unknown",
    });
    return { ok: false, error };
  }

  /** Dispatches one action and maps a runtime rejection or thrown failure to the client-facing answer; `label` keeps the log line distinguishable. */
  private runAction(
    raw: unknown,
    label: string,
    dispatch: () => ProtocolError | undefined,
  ): ActionResult {
    try {
      const error = dispatch();
      return error ? this.rejected(raw, error) : { ok: true };
    } catch (error) {
      logger.error(`[ActionRouter] ${label} failed`, error);
      this.deps.logLine("warn", "action.rejected", {
        code: ErrorCode.INTERNAL,
        action: this.actionTypeOf(raw) ?? "unknown",
      });
      return { ok: false, error: { code: ErrorCode.INTERNAL, message: CLIENT_MESSAGES.INTERNAL } };
    }
  }
}
