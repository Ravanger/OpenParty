import { logger } from "@colyseus/core";
import { type GameDefinition, type GameRuntime, getActionLog, required } from "@openparty/core";
import { createBundle } from "@openparty/core/replay";
import {
  CLIENT_MESSAGES,
  ErrorCode,
  FRAMEWORK_VERSION,
  type ServerError as ProtocolError,
} from "@openparty/shared";
import type { BaseGameState, PlayerSchema } from "@openparty/shared/schema";

/** One recorded phase transition and the synced-state snapshot taken at that moment. */
export interface ReplaySnapshot {
  /** The phase left. */
  from: string;
  /** The phase entered. */
  to: string;
  /** The room's synced state at the transition, as JSON-safe data. */
  state: unknown;
}

/**
 * Records one synced-state snapshot per phase transition and assembles them into an exportable
 * replay bundle. A bundle needs both halves — the action log's transition entries and these
 * snapshots — so recording stops once the bound the export can complete within is reached, and
 * the export refuses rather than ship a truncated bundle.
 */
export class ReplayRecorder {
  /** The fixed refusal for an export whose two halves no longer line up. */
  private readonly unavailable: ProtocolError = {
    code: ErrorCode.NOT_ALLOWED,
    message: CLIENT_MESSAGES.NOT_ALLOWED,
  };

  constructor(
    private readonly definition: GameDefinition<BaseGameState, unknown, unknown>,
    private readonly maxTransitions: number,
    /** The room's snapshot storage: this recorder fills it and reads from it at export. */
    private readonly snapshots: ReplaySnapshot[],
  ) {}

  /** Records one transition's synced-state snapshot, up to the bound the export can complete within. */
  record(from: string, to: string, state: unknown): void {
    if (this.snapshots.length < this.maxTransitions) this.snapshots.push({ from, to, state });
  }

  /** The room's replay bundle for a host seat, or a fixed refusal; never leaks exception text. */
  export(
    runtime: GameRuntime<BaseGameState, unknown, unknown>,
    seat: PlayerSchema | undefined,
  ): unknown {
    if (seat?.role !== "host")
      return {
        ok: false,
        error: { code: ErrorCode.UNAUTHORIZED, message: CLIENT_MESSAGES.UNAUTHORIZED },
      };
    try {
      const log = getActionLog(runtime.priv);
      if (!log) return { ok: false, error: this.unavailable };
      const transitions = log.entries.filter((entry) => entry.kind === "transition");
      if (transitions.length !== this.snapshots.length)
        return { ok: false, error: this.unavailable };
      return createBundle({
        name: this.definition.name,
        frameworkVersion: FRAMEWORK_VERSION,
        gameVersion: this.definition.version,
        contentHash: this.definition.contentHash?.() ?? "",
        log,
        snapshots: this.snapshots.map((snap, index) => ({
          seq: required(transitions[index], "transition entry").seq,
          phase: snap.from,
          state: snap.state,
        })),
      });
    } catch (error) {
      logger.error("[ReplayRecorder] replay export failed", error);
      return { ok: false, error: { code: ErrorCode.INTERNAL, message: CLIENT_MESSAGES.INTERNAL } };
    }
  }
}
