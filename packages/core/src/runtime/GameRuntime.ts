import {
  CLIENT_MESSAGES,
  END_GAME,
  ErrorCode,
  FrameworkError,
  KICK_PLAYER,
  LOBBY_PHASE,
  PAUSE_GAME,
  RESUME_GAME,
  type ServerError,
  ServerMessage,
} from "@openparty/shared";
import { createActor } from "xstate";
import { deepFreeze, newId } from "../utils.js";
import { DispatchPipeline } from "./DispatchPipeline.js";
import type { RuntimeHost, TimerHandle } from "./host.js";
import { pickNextHost } from "./hostMigration.js";
import { Lobby } from "./lobby.js";
import { type ContextLogger, type Logger, type LogLine, noopLogger } from "./logger.js";
import { MiddlewareChain } from "./MiddlewareChain.js";
import { buildPhaseMachine } from "./machineFactory.js";
import { PausableClock } from "./PausableClock.js";
import { PhaseTicker } from "./PhaseTicker.js";
import { MAX_PAUSE_MS } from "./pause.js";
import { type CoreStrings, mergeCoreStrings } from "./strings.js";
import { type Pending, PhaseLoopError, TransitionQueue } from "./TransitionQueue.js";
import type {
  ActionDefinition,
  GameContext,
  GameDefinition,
  MiddlewareEvent,
  PhaseDefinition,
  PhaseState,
} from "./types.js";

/** Thrown by the {@link GameRuntime} constructor when `createPrivateState()` returns a non-object. */
export class InvalidPrivateStateError extends Error {
  constructor() {
    super("createPrivateState() must return an object");
    this.name = "InvalidPrivateStateError";
  }
}

interface PhaseActor {
  start(): void;
  stop(): void;
  send(event: { type: "GO"; phase: string }): void;
}

/** Constructor argument of {@link GameRuntime}. */
export interface GameRuntimeConfig<TState extends PhaseState, TPrivate, TOptions> {
  definition: GameDefinition<TState, TPrivate, TOptions>;
  /** The synced state object; the runtime writes `phase`, `phaseEndsAt` and `phaseDurationMs` into it. */
  state: TState;
  /** Room options, already parsed with `definition.options` when the game has one. */
  options: TOptions;
  host: RuntimeHost;
}

/**
 * Runs one game room. An XState actor generated from the definition owns the current phase and its timer;
 * hooks and handlers run inside it, and the transitions they request are applied once they return.
 * Starts in `Lobby` on construction. Call {@link GameRuntime.stop} when the room is disposed.
 */
export class GameRuntime<TState extends PhaseState, TPrivate, TOptions = Record<string, unknown>> {
  readonly priv: TPrivate;
  private readonly spec: GameDefinition<TState, TPrivate, TOptions>;
  private readonly state: TState;
  private options: TOptions;
  private readonly host: RuntimeHost;
  /** The host's logger, or the no-op when the host provides none. */
  private readonly logger: Logger;
  /** The `ctx.log` wrapper over the host's logger: a call is an info line. */
  private readonly contextLog: ContextLogger;
  /** The definition's `strings` over the defaults; every core-owned message comes from it. */
  private readonly strings: CoreStrings;
  private readonly lobby: Lobby<TState, TPrivate, TOptions>;
  private readonly builtins: Record<string, ActionDefinition<TState, TPrivate, TOptions, unknown>>;
  private readonly phases: Record<string, PhaseDefinition<TState, TPrivate, TOptions>>;
  private readonly chain: MiddlewareChain<TState, TPrivate, TOptions>;
  private readonly ticker: PhaseTicker<TState, TPrivate, TOptions>;
  private readonly actorClock: PausableClock;
  private readonly pipeline: DispatchPipeline<TState, TPrivate, TOptions>;
  private readonly actor: PhaseActor;
  private readonly queue = new TransitionQueue();
  private readonly failures: unknown[] = [];
  private readonly rejections: ServerError[] = [];
  /** Rejections this dispatch recorded with `redactPayload`; reset like `rejections`. */
  private redactedRejections = 0;
  private current: PhaseDefinition<TState, TPrivate, TOptions>;
  private phaseName: string = LOBBY_PHASE;
  private duration = 0;
  private stopped = false;
  private hasStarted = false;
  private lobbyReturnFailed = false;
  /** True between a host `PAUSE_GAME` and its `RESUME_GAME` (or the maximum-pause auto-end). */
  private paused = false;
  /** Epoch ms the current pause began; set together with `paused`, read by `resume`. */
  private pauseStartedAt = 0;
  /** The safety timer that ends an abandoned pause; arms only while paused. */
  private pauseTimer: TimerHandle | undefined = undefined;

  constructor(config: GameRuntimeConfig<TState, TPrivate, TOptions>) {
    this.spec = config.definition;
    this.state = config.state;
    this.host = config.host;
    this.logger = this.host.log ?? noopLogger;
    this.contextLog = Object.assign(
      (event: string, fields?: LogLine["fields"]) => this.logger.info(event, fields),
      {
        warn: (event: string, fields?: LogLine["fields"]) => this.logger.warn(event, fields),
        error: (event: string, fields?: LogLine["fields"]) => this.logger.error(event, fields),
      },
    );
    this.strings = mergeCoreStrings(config.definition.strings);
    this.options = deepFreeze(config.options) as TOptions;
    const priv = this.spec.createPrivateState();
    if (typeof priv !== "object" || priv === null) throw new InvalidPrivateStateError();
    this.priv = priv;
    this.lobby = new Lobby<TState, TPrivate, TOptions>({
      definition: this.spec,
      host: this.host,
      options: {
        get: () => this.options,
        set: (next) => {
          this.options = deepFreeze(next) as TOptions;
        },
      },
      hasStarted: () => this.hasStarted,
      rosterChanged: () => this.rosterChange(),
      pause: () => this.pause(),
      resume: () => this.resume(),
    });
    this.ticker = new PhaseTicker<TState, TPrivate, TOptions>({
      host: this.host,
      run: (fn) => this.run(fn),
      context: () => this.context(),
    });
    this.chain = new MiddlewareChain<TState, TPrivate, TOptions>({
      layers: this.spec.middleware ?? [],
      context: () => this.context(),
      rejectionCount: () => this.rejections.length,
      redactedRejectionCount: () => this.redactedRejections,
      ticks: () => (this.current.onTick !== undefined ? this.ticker.count : undefined),
      reject: (senderId, actionType, code, message, redactPayload) =>
        this.reject(senderId, actionType, code, message, redactPayload),
    });
    this.builtins = {
      [KICK_PLAYER]: this.lobby.kickAction(),
      [END_GAME]: this.lobby.endGameAction(),
      [PAUSE_GAME]: this.lobby.pauseAction(),
      [RESUME_GAME]: this.lobby.resumeAction(),
    };
    this.phases = { ...this.spec.phases, [LOBBY_PHASE]: this.lobby.phase() };
    this.pipeline = new DispatchPipeline<TState, TPrivate, TOptions>({
      builtins: this.builtins,
      currentPhaseActions: () => this.current.actions,
      declaredInAnyPhase: (type) =>
        Object.values(this.phases).some((p) => p.actions && type in p.actions),
      phaseName: () => this.phaseName,
      players: () => this.host.players(),
      strings: this.strings,
      contextFactory: () => this.context(),
      filterLevel: () => this.spec.filterLevel?.(this.options) ?? "off",
      paused: () => this.paused,
      audienceOnce: (audienceKey, scope) => this.host.audienceOnce(audienceKey, scope),
      reject: (playerId, action, code, message) => this.reject(playerId, action, code, message),
      chain: (event, inner) => this.chain.run(event, () => this.rejectThrown(event, inner)),
    });
    this.current = this.phases[LOBBY_PHASE] as PhaseDefinition<TState, TPrivate, TOptions>;
    this.actorClock = new PausableClock(this.host);
    this.actor = createActor(
      buildPhaseMachine({
        phases: this.phases,
        enter: (name) =>
          this.enter(name, this.phases[name] as PhaseDefinition<TState, TPrivate, TOptions>),
        timeout: () =>
          this.chain.run({ kind: "timeout" }, () => this.current.onTimeout?.(this.context())),
        duration: () => this.duration,
        guard: (fn) => this.guarded(fn),
      }),
      {
        clock: {
          setTimeout: (callback, ms) => this.actorClock.setTimeout(() => this.run(callback), ms),
          clearTimeout: (handle) => this.actorClock.clearTimeout(handle),
        },
      },
    );
    try {
      this.run(() => this.actor.start());
    } catch {
      // Already reported to onError and the failure policy; a broken initial enter must not kill construction.
    }
  }

  /** Name of the current phase. */
  get phase(): string {
    return this.phaseName;
  }

  /**
   * Handle a client `ACTION` message. Every rejection is sent to `playerId` as `ERROR`;
   * the first one is also returned so a request can answer with it. A {@link FrameworkError}
   * thrown by the pipeline or a handler answers with its code and the fixed client message,
   * without running the failure policy. After {@link GameRuntime.stop} every action fails
   * with `NOT_ALLOWED`.
   */
  dispatch(playerId: string, rawAction: unknown): ServerError | undefined {
    return this.dispatchTo(playerId, rawAction, (id, raw) => this.pipeline.run(id, raw));
  }

  /**
   * Handle an audience `ACTION` from a seatless sender identified by the opaque `audienceKey`.
   * Only actions declared `from: "audience"` are accepted; everything else is refused. Rejections
   * are sent to the key as `ERROR`, exactly like {@link GameRuntime.dispatch}. After
   * {@link GameRuntime.stop} every action fails with `NOT_ALLOWED`.
   */
  dispatchAudience(audienceKey: string, rawAction: unknown): ServerError | undefined {
    return this.dispatchTo(audienceKey, rawAction, (id, raw) => this.pipeline.runAudience(id, raw));
  }

  /** The shared dispatch path: reset the rejection bookkeeping, run one pipeline step, answer with the first rejection. */
  private dispatchTo(
    senderId: string,
    rawAction: unknown,
    handle: (senderId: string, rawAction: unknown) => void,
  ): ServerError | undefined {
    if (this.stopped) return this.stoppedError();
    this.rejections.length = 0;
    this.redactedRejections = 0;
    try {
      this.run(() => handle(senderId, rawAction), true);
    } catch (error) {
      if (!(error instanceof FrameworkError)) throw error;
      return this.recordFrameworkError(senderId, error);
    }
    return this.rejections[0];
  }

  /** Call after any join, leave, connect, disconnect or ready change. */
  rosterChanged(): void {
    if (this.stopped) return;
    this.run(() => this.rosterChange());
  }

  /** Call after a player (re)connects so the game can resend their private messages. */
  syncPlayer(playerId: string): void {
    if (this.stopped) return;
    this.run(() => this.spec.onPlayerSync?.(this.context(), playerId));
  }

  /** Stop the actor and clear every timer. The runtime ignores all further calls. */
  stop(): void {
    this.stopped = true;
    this.queue.clear();
    this.clearPauseTimer();
    this.actor.stop();
    this.ticker.clear();
  }

  /**
   * Run `fn` as one full runtime step: a throw is collected and reported like any other failed
   * run, and transitions queued during it (for example by an `onTick`) are drained before it
   * returns. Replay uses it to apply deferred ticks at entry boundaries (#246). A stopped
   * runtime ignores the call.
   */
  runStep(fn: () => void): void {
    if (this.stopped) return;
    this.run(fn);
  }

  private context(): GameContext<TState, TPrivate, TOptions> {
    return {
      state: this.state,
      priv: this.priv,
      options: this.options,
      phase: this.phaseName,
      players: () => this.host.players(),
      activePlayers: () =>
        this.host.players().filter((p) => p.isConnected && p.isReady && p.isActive),
      player: (id) => this.host.players().find((p) => p.id === id),
      activateWaitingPlayers: () => this.host.activateWaitingPlayers(),
      send: (playerId, type, payload) => this.host.send(playerId, type, payload),
      broadcast: (type, payload) => this.host.broadcast(type, payload),
      showTo: (playerId, ref) => this.host.showTo(playerId, ref),
      hideFrom: (playerId, ref) => this.host.hideFrom(playerId, ref),
      transition: (phase) => {
        if (!Object.hasOwn(this.phases, phase)) throw new Error(`Unknown phase "${phase}"`);
        this.queue.push({ kind: "phase", phase });
      },
      returnToLobby: () => {
        this.queue.push({ kind: "lobby" });
      },
      rng: () => this.host.rng(),
      newId: () => newId(() => this.host.rng()),
      now: () => this.host.now(),
      log: this.contextLog,
      gameName: this.spec.name,
      gameVersion: this.spec.version,
      seed: this.host.seed,
      strings: this.strings,
    };
  }

  private rosterChange(): void {
    this.migrateHost();
    this.chain.run({ kind: "roster-change" }, () => this.current.onRosterChange?.(this.context()));
  }

  /** Promotes a new host when the current one is not connected, per `hostMigration`. */
  private migrateHost(): void {
    const setHost = this.host.setHost;
    if (setHost === undefined) return; // replay hosts never migrate: no picker call, no rng draw
    const players = this.host.players();
    const host = players.find((p) => p.role === "host");
    if (host?.isConnected) return;
    const nextId = pickNextHost(this.spec.hostMigration ?? "next-seated", players, () =>
      this.host.rng(),
    );
    if (nextId !== undefined) setHost(nextId);
  }

  /** Freeze the current phase: its timing timer, its ticks and every queued action. */
  private pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pauseStartedAt = this.host.now();
    this.state.pausedAt = this.pauseStartedAt;
    this.actorClock.pause();
    this.ticker.pause();
    this.pauseTimer = this.host.setTimeout(() => this.run(() => this.endLongPause()), MAX_PAUSE_MS);
  }

  /** Resume a paused phase, shifting its deadline by exactly the paused time. */
  private resume(): void {
    if (!this.paused) return;
    const pausedMs = this.host.now() - this.pauseStartedAt;
    this.paused = false;
    this.state.pausedAt = 0;
    this.pauseStartedAt = 0;
    if (this.state.phaseEndsAt > 0) this.state.phaseEndsAt += pausedMs;
    this.clearPauseTimer();
    this.actorClock.resume();
    this.ticker.resume();
  }

  /** The safety timer: a pause that outlasted `MAX_PAUSE_MS` ends the game to the Lobby. */
  private endLongPause(): void {
    this.paused = false;
    this.pauseTimer = undefined;
    this.state.pausedAt = 0;
    this.pauseStartedAt = 0;
    this.state.notice = this.strings.pausedTooLong;
    this.queue.push({ kind: "lobby" });
  }

  /** Drops the pause bookkeeping for a phase entry; the actor cancels any paused timer on exit. */
  private resetPause(): void {
    this.paused = false;
    this.state.pausedAt = 0;
    this.pauseStartedAt = 0;
    this.clearPauseTimer();
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer === undefined) return;
    this.host.clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
  }

  private enter(name: string, phase: PhaseDefinition<TState, TPrivate, TOptions>): void {
    // A pause belongs to one phase: leaving it (or re-entering) clears the pause first.
    this.resetPause();
    // Reset before the enter event is observed, so the recorded entry carries 0 ticks.
    this.ticker.reset();
    this.phaseName = name;
    this.hasStarted ||= name !== LOBBY_PHASE;
    this.current = phase;
    this.state.phase = name;
    if (phase.duration === undefined) {
      this.duration = 0;
      this.state.phaseEndsAt = 0;
    } else {
      this.duration =
        typeof phase.duration === "function" ? phase.duration(this.context()) : phase.duration;
      this.state.phaseEndsAt = this.host.now() + this.duration;
    }
    this.state.phaseDurationMs = this.duration;
    this.chain.run({ kind: "enter" }, () => phase.onEnter?.(this.context()));
    this.ticker.start(phase);
  }

  private guarded(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.failures.push(error);
    }
  }

  /** Run a queued transition, collecting a direct throw (an unguarded `onReturnToLobby`) as a failure. */
  private applyGuarded(next: Pending): void {
    try {
      this.apply(next);
    } catch (error) {
      this.failures.push(error);
    }
  }

  /** The default failure policy: a fixed notice, and the Lobby when not already there. */
  private defaultFailurePolicy(): void {
    this.state.notice = this.strings.failureNotice;
    if (this.phaseName === LOBBY_PHASE) return;
    if (!this.lobbyReturnFailed) {
      this.guarded(() => this.observeTransition(this.phaseName, LOBBY_PHASE));
      this.guarded(() => this.spec.onReturnToLobby?.(this.context()));
    }
    this.guarded(() => this.host.activateWaitingPlayers());
    this.guarded(() => this.actor.send({ type: "GO", phase: LOBBY_PHASE }));
  }

  /**
   * One failed run: report every collected failure to `onError` once, then apply the default
   * policy unless `onError` queued its own transition, and rethrow what was reported so callers
   * (`dispatch`, `GameRoom.act`) still see the failure. Failures raised by `onError` or the
   * policy itself join the rethrow; they are logged, not recursed on.
   */
  private failRun(): void {
    const failed = this.failures.splice(0);
    let reported: unknown =
      failed.length === 1 ? failed[0] : new AggregateError(failed, "Game hook failed");
    this.queue.clear();
    this.guarded(() => this.spec.onError?.(this.context(), reported));
    if (this.queue.isEmpty() || !this.drainFailureTransitions()) this.defaultFailurePolicy();
    this.lobbyReturnFailed = false;
    const extra = this.failures.splice(0);
    if (extra.length > 0) reported = new AggregateError([...failed, ...extra], "Game hook failed");
    throw reported;
  }

  /** Applies what `onError` queued; false when it looped, so the caller falls back to the default policy. */
  private drainFailureTransitions(): boolean {
    try {
      this.queue.drain(
        (next) => this.applyGuarded(next),
        () => {},
      );
      return true;
    } catch (error) {
      this.failures.push(error);
      return false;
    }
  }

  private drainRun(): void {
    try {
      this.queue.drain(
        (next) => this.applyGuarded(next),
        () => {
          if (this.failures.length > 0) this.failRun();
        },
      );
    } catch (error) {
      if (!(error instanceof PhaseLoopError)) throw error;
      this.failures.push(error);
      this.failRun();
    }
  }

  private run(fn: () => void, typedOutcome = false): void {
    try {
      try {
        fn();
      } catch (error) {
        if (typedOutcome && error instanceof FrameworkError) {
          this.queue.clear();
          throw error;
        }
        this.failures.push(error);
      }
      if (this.failures.length > 0) this.failRun();
      this.drainRun();
    } finally {
      this.refreshCanStart();
    }
  }

  private refreshCanStart(): void {
    this.state.canStart = this.phaseName === LOBBY_PHASE && this.lobby.canStart(this.context());
  }

  private observeTransition(from: string, to: string): void {
    this.chain.run({ kind: "transition", from, to }, () => {});
    this.host.notifyTransition(from, to);
  }

  private apply(next: Pending): void {
    // An observer throw must not cancel the transition it observes (docs: middleware cannot veto);
    // defer it like any hook failure and let the transition apply, then surface via failRun.
    this.guarded(() =>
      this.observeTransition(this.phaseName, next.kind === "lobby" ? LOBBY_PHASE : next.phase),
    );
    if (next.kind === "lobby") {
      this.lobbyReturnFailed = true;
      this.spec.onReturnToLobby?.(this.context());
      this.host.activateWaitingPlayers();
      this.actor.send({ type: "GO", phase: LOBBY_PHASE });
      this.lobbyReturnFailed = false;
    } else {
      if (this.phaseName === LOBBY_PHASE) this.host.benchUnreadyPlayers();
      this.actor.send({ type: "GO", phase: next.phase });
    }
  }

  /** Inside the chain, so middleware sees a handler-thrown FrameworkError as a rejection. */
  private rejectThrown(event: MiddlewareEvent, inner: () => void): void {
    try {
      inner();
    } catch (error) {
      if (!(error instanceof FrameworkError) || event.kind !== "action") throw error;
      this.queue.clear();
      this.recordFrameworkError(event.senderId, error);
    }
  }

  /** Every action after `stop()` fails with this. */
  private stoppedError(): ServerError {
    return { code: ErrorCode.NOT_ALLOWED, message: this.strings.stopped };
  }

  private recordFrameworkError(playerId: string, error: FrameworkError): ServerError {
    const serverError: ServerError = { code: error.code, message: CLIENT_MESSAGES[error.code] };
    this.rejections.push(serverError);
    this.host.send(playerId, ServerMessage.ERROR, serverError);
    return serverError;
  }

  private reject(
    playerId: string,
    action: string | undefined,
    code: ErrorCode,
    message: string,
    redactPayload?: boolean,
  ): void {
    const error: ServerError = action === undefined ? { code, message } : { code, message, action };
    this.rejections.push(error);
    if (redactPayload) ++this.redactedRejections;
    this.host.send(playerId, ServerMessage.ERROR, error);
  }
}
