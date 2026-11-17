import type { Client } from "@colyseus/core";
import type { FilterLevel, TextFilter } from "@openparty/content/filter";
import type { GameDefinition } from "@openparty/core";
import {
  CLIENT_MESSAGES,
  ClientMessage,
  ErrorCode,
  LOBBY_PHASE,
  ServerMessage,
  SetNameSchema,
} from "@openparty/shared";
import type { BaseGameState, PlayerSchema } from "@openparty/shared/schema";
import type { TokenBucket } from "../RateLimiter.js";

/** Everything the name policy needs from its room. */
export interface NamePolicyDeps {
  /** The game definition; its `filterLevel` maps the live options to a filter level. */
  definition: GameDefinition<BaseGameState, unknown, unknown>;
  /** The server's text filter; `undefined` when the server runs unfiltered. */
  textFilter: TextFilter | undefined;
  /** The room's current parsed options. */
  options: () => Record<string, unknown>;
  /** Every seat in the room. */
  players: () => Iterable<PlayerSchema>;
  /** The seat of the session behind `client`, if any (a miss already pushed the spectator error). */
  seatOf: (client: Client) => PlayerSchema | undefined;
  /** The room's current phase name. */
  phase: () => string;
  /** Takes one token from `playerId`'s bucket for `messageType`; false when refused in enforce mode. */
  limited: (playerId: string, messageType: string, bucket: TokenBucket) => boolean;
  /** The SET_NAME bucket. */
  setNameBucket: TokenBucket;
  /** Notifies the runtime of a roster change after a rename. */
  rosterChanged: () => void;
}

/**
 * The room's name policy: the text-filter level read from the live options, the filter check and
 * the case-insensitive uniqueness check, plus the rate-limited `SET_NAME` handler built on them.
 */
export class NamePolicy {
  constructor(private readonly deps: NamePolicyDeps) {}

  /** The room's current text-filter level: the definition's `filterLevel` over the live options, default `"off"`. */
  filterLevel(): FilterLevel {
    return this.deps.definition.filterLevel?.(this.deps.options()) ?? "off";
  }

  /** The filter's reason when `name` fails at the room's current level; `undefined` when it passes or no filter is set. */
  rejected(name: string): string | undefined {
    const filter = this.deps.textFilter;
    if (!filter) return undefined;
    const result = filter.check(name, this.filterLevel());
    return result.ok ? undefined : result.reason;
  }

  /** True when another seated player already uses `name` (compared trimmed and case-insensitively). */
  taken(playerId: string, name: string): boolean {
    const wanted = name.trim().toLowerCase();
    for (const seat of this.deps.players()) {
      if (seat.id !== playerId && seat.name.trim().toLowerCase() === wanted) return true;
    }
    return false;
  }

  /** The `SET_NAME` message handler: rate-limited, then filtered and uniqueness-checked. */
  set(client: Client, raw: unknown): void {
    const seat = this.deps.seatOf(client);
    if (!seat) return;
    if (!this.deps.limited(seat.id, ClientMessage.SET_NAME, this.deps.setNameBucket)) {
      client.send(ServerMessage.ERROR, {
        code: ErrorCode.RATE_LIMITED,
        message: CLIENT_MESSAGES.RATE_LIMITED,
      });
      return;
    }
    const name = SetNameSchema.safeParse(raw);
    if (!name.success) {
      client.send(ServerMessage.ERROR, {
        code: ErrorCode.INVALID_ACTION,
        message: CLIENT_MESSAGES.INVALID_ACTION,
      });
      return;
    }
    const reason = this.rejected(name.data);
    if (reason !== undefined) {
      client.send(ServerMessage.ERROR, { code: ErrorCode.CONTENT_REJECTED, message: reason });
      return;
    }
    if (this.taken(seat.id, name.data)) {
      client.send(ServerMessage.ERROR, {
        code: ErrorCode.NAME_TAKEN,
        message: CLIENT_MESSAGES.NAME_TAKEN,
      });
      return;
    }
    seat.name = name.data;
    seat.isReady = true;
    if (this.deps.phase() === LOBBY_PHASE) seat.isActive = true;
    this.deps.rosterChanged();
  }
}
