import {
  CLIENT_MESSAGES,
  ErrorCode,
  FrameworkError,
  LOBBY_PHASE,
  PlayerIdSchema,
  SET_OPTIONS,
  START_GAME,
} from "@openparty/shared";
import { z } from "zod";
import { EmptyPayloadSchema } from "../actions.js";
import type { RuntimeHost } from "./host.js";
import { resolveGameOptions } from "./options.js";
import { type CoreStrings, mergeCoreStrings } from "./strings.js";
import type {
  ActionDefinition,
  GameContext,
  GameDefinition,
  PhaseDefinition,
  PhaseState,
} from "./types.js";

/** What the {@link Lobby} needs from the runtime that owns it. */
export interface LobbyBindings<TState extends PhaseState, TPrivate, TOptions> {
  definition: GameDefinition<TState, TPrivate, TOptions>;
  host: RuntimeHost;
  options: { get(): TOptions; set(next: TOptions): void };
  hasStarted(): boolean;
  /** Runs the current phase's `onRosterChange`. */
  rosterChanged(): void;
  /** Freezes the current phase's clock and ticks; the runtime's `PAUSE_GAME` handler. */
  pause(): void;
  /** Resumes a paused phase and shifts its deadline; the runtime's `RESUME_GAME` handler. */
  resume(): void;
}

/** The built-in `Lobby` phase (`START_GAME`, `SET_OPTIONS`, optional auto-start) and the `KICK_PLAYER` and `END_GAME` actions. */
export class Lobby<TState extends PhaseState, TPrivate, TOptions> {
  /** The definition's `strings` over the defaults; the built-in refusals come from it. */
  private readonly strings: CoreStrings;

  constructor(private readonly bindings: LobbyBindings<TState, TPrivate, TOptions>) {
    this.strings = mergeCoreStrings(bindings.definition.strings);
  }

  /** The rule `START_GAME` enforces; published to clients as `state.canStart`. */
  canStart(ctx: GameContext<TState, TPrivate, TOptions>): boolean {
    return ctx.activePlayers().length >= this.bindings.definition.minPlayers;
  }

  phase(): PhaseDefinition<TState, TPrivate, TOptions> {
    const { definition, hasStarted } = this.bindings;
    return {
      actions: { [START_GAME]: this.startGame(), [SET_OPTIONS]: this.setOptions() },
      onRosterChange: (ctx) => {
        const everyoneReady = ctx.players().every((p) => p.isReady);
        if (definition.autoStart && !hasStarted() && everyoneReady && this.canStart(ctx)) {
          ctx.transition(definition.startPhase);
        }
      },
    };
  }

  kickAction(): ActionDefinition<TState, TPrivate, TOptions, { playerId: string }> {
    return {
      from: "host",
      payload: z.object({ playerId: PlayerIdSchema }),
      handler: (ctx) => {
        const { playerId } = ctx.payload;
        if (playerId === ctx.playerId) {
          ctx.reject(ErrorCode.NOT_ALLOWED, this.strings.cannotKickSelf);
        } else if (!ctx.player(playerId)) {
          ctx.reject(ErrorCode.NOT_ALLOWED, this.strings.noSuchPlayer);
        } else {
          this.bindings.host.kick(playerId);
          this.bindings.rosterChanged();
        }
      },
    };
  }

  endGameAction(): ActionDefinition<TState, TPrivate, TOptions, unknown> {
    const { definition } = this.bindings;
    return {
      from: "host",
      payload: EmptyPayloadSchema,
      handler: (ctx) => {
        if (ctx.phase === LOBBY_PHASE) {
          throw new FrameworkError(ErrorCode.WRONG_PHASE, this.strings.endGameInLobby);
        }
        definition.onEndGame?.(ctx);
        ctx.returnToLobby();
      },
    };
  }

  /** The built-in `PAUSE_GAME`: host-only, any phase but the Lobby, a no-op while already paused. */
  pauseAction(): ActionDefinition<TState, TPrivate, TOptions, unknown> {
    return {
      from: "host",
      payload: EmptyPayloadSchema,
      handler: (ctx) => {
        if (ctx.phase === LOBBY_PHASE) {
          throw new FrameworkError(ErrorCode.WRONG_PHASE, this.strings.pauseInLobby);
        }
        this.bindings.pause();
      },
    };
  }

  /** The built-in `RESUME_GAME`: host-only, any phase but the Lobby, a no-op while running. */
  resumeAction(): ActionDefinition<TState, TPrivate, TOptions, unknown> {
    return {
      from: "host",
      payload: EmptyPayloadSchema,
      handler: (ctx) => {
        if (ctx.phase === LOBBY_PHASE) {
          throw new FrameworkError(ErrorCode.WRONG_PHASE, this.strings.resumeInLobby);
        }
        this.bindings.resume();
      },
    };
  }

  private startGame(): ActionDefinition<TState, TPrivate, TOptions, unknown> {
    const { definition } = this.bindings;
    return {
      from: "host",
      payload: EmptyPayloadSchema,
      handler: (ctx) => {
        if (!this.canStart(ctx)) {
          throw new FrameworkError(
            ErrorCode.NOT_ENOUGH_PLAYERS,
            this.strings.needAtLeast(definition.minPlayers),
          );
        }
        if (ctx.state.notice) ctx.state.notice = "";
        ctx.transition(definition.startPhase);
      },
    };
  }

  private setOptions(): ActionDefinition<TState, TPrivate, TOptions, Record<string, unknown>> {
    const { definition, options, host } = this.bindings;
    return {
      from: "host",
      payload: z.looseObject({}),
      handler: (ctx) => {
        const { type: _type, ...partial } = ctx.payload;
        if (!definition.options) {
          // A game without an options schema has fixed options: extra keys are refused and an
          // empty SET_OPTIONS republishes the unchanged value. The no-schema guard stays here
          // (not in resolveGameOptions) because it is the sent keys that are refused, while the
          // merge can carry non-empty current options.
          if (Object.keys(partial).length > 0) {
            ctx.reject(ErrorCode.INVALID_ACTION, CLIENT_MESSAGES.INVALID_ACTION);
            return;
          }
          const merged = { ...options.get(), ...partial };
          options.set(merged as TOptions);
          host.publishOptions(merged);
          return;
        }
        const resolved = resolveGameOptions(definition, { ...options.get(), ...partial });
        if (!resolved.ok) {
          ctx.reject(ErrorCode.INVALID_ACTION, CLIENT_MESSAGES.INVALID_ACTION);
          return;
        }
        options.set(resolved.options);
        host.publishOptions(resolved.options);
      },
    };
  }
}
