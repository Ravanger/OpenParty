import {
  ACTION_NAME_PATTERN,
  END_GAME,
  type ErrorCode,
  KICK_PLAYER,
  LOBBY_PHASE,
  PAUSE_GAME,
  RESUME_GAME,
  SET_OPTIONS,
  START_GAME,
} from "@openparty/shared";
import type { z } from "zod";
import {
  type ContextLogger,
  type GameContext,
  GameDefinitionError,
  type PhaseAction,
  type PhaseDefinition,
  type PhaseState,
  type PlayerInfo,
} from "../runtime/index.js";

const PHASE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED_ACTIONS: readonly string[] = [
  START_GAME,
  KICK_PLAYER,
  SET_OPTIONS,
  END_GAME,
  PAUSE_GAME,
  RESUME_GAME,
];
/** Which prefixes each defined module has been mounted with (a failed mount registers nothing). */
const mounts = new WeakMap<object, Set<string>>();

/**
 * The context a round module's phase hooks receive: the host context narrowed to the module's slice,
 * private slice and params — the only host state a module can read or write. `transition` takes a
 * module-local phase name (the mount maps it to its prefixed one); `finish()` ends the run.
 *
 * @experimental Round module API; may change before 1.0.
 */
export interface RoundModuleContext<TSlice, TPriv, TParams> {
  /** The module's slice of the host's synced state. */
  readonly state: TSlice;
  /** The module's private slice of the host's server-only state. */
  readonly priv: TPriv;
  /** The per-run parameters, from `mountRoundModule`'s `params`. */
  readonly params: TParams;
  /** The current phase name without the mount prefix (the module-local name). */
  readonly phase: string;
  /** Every seat. */
  players(): PlayerInfo[];
  /** Seats that are connected, ready and active. */
  activePlayers(): PlayerInfo[];
  /** The seat with this id, if seated. */
  player(id: string): PlayerInfo | undefined;
  send(playerId: string, type: string, payload: unknown): void;
  broadcast(type: string, payload: unknown): void;
  /** Make a `.view()`-tagged part of the slice visible to one player. Re-applied by the server on reconnect. */
  showTo(playerId: string, ref: object): void;
  hideFrom(playerId: string, ref: object): void;
  /** Queue a transition to another phase of this module by its local name. */
  transition(phase: string): void;
  /**
   * End the module run: `result` is computed from the slice and the mount's `onDone(hostCtx, result)`
   * runs with the host's full context, from which the host leaves the module (queue a transition or
   * `returnToLobby`).
   */
  finish(): void;
  /** Queued; runs the host's `onReturnToLobby` and then enters `Lobby`. */
  returnToLobby(): void;
  /** Random number in [0, 1). */
  rng(): number;
  /** A UUID-shaped identifier drawn from the room RNG. */
  newId(): string;
  /** Epoch ms. */
  now(): number;
  /** Logs a structured line for this room, e.g. `ctx.log("custom.event", { n: 1 })` (info) or `ctx.log.warn(...)`. Field values are strings, numbers or booleans; never names or payloads. */
  log: ContextLogger;
}

/**
 * The context of a round module's action handler: the module context plus the actor, the parsed
 * payload and `reject`.
 *
 * @experimental Round module API; may change before 1.0.
 */
export interface RoundModuleActionContext<TSlice, TPriv, TParams, TPayload>
  extends RoundModuleContext<TSlice, TPriv, TParams> {
  /** The acting seat. */
  readonly playerId: string;
  /** The parsed payload. */
  readonly payload: TPayload;
  /** Send an `ERROR` to the actor. Does not stop the handler. */
  reject(code: ErrorCode, message: string): void;
}

/**
 * One client action accepted by a round module's phase; declare it under its unprefixed name —
 * the mount prefixes it (`<PREFIX>__<ACTION>`).
 *
 * @experimental Round module API; may change before 1.0.
 */
export interface RoundModuleAction<TSlice, TPriv, TParams, TPayload> {
  /** `"player"` means any active player, including the host. */
  from: "host" | "player";
  /** Validates the whole action object (`type` plus flat fields). */
  payload: z.ZodType<TPayload>;
  /** Payload fields that hold free text; `textFilterMiddleware` checks exactly these. The framework never guesses. */
  textFields?: readonly string[];
  /** Runs for one accepted action of this phase. */
  handler(ctx: RoundModuleActionContext<TSlice, TPriv, TParams, TPayload>): void;
}

/**
 * One phase of a round module: like a game phase, but its hooks run over the module's slice and
 * private slice instead of the host's full state.
 *
 * @experimental Round module API; may change before 1.0.
 */
export interface RoundModulePhase<TSlice, TPriv, TParams> {
  /** Milliseconds, or computed on entry. The timer restarts on every entry. */
  duration?: number | ((ctx: RoundModuleContext<TSlice, TPriv, TParams>) => number);
  /** Interval in ms between `onTick` calls; default 100 (10 Hz). Must be an integer >= 1 and is ignored without `onTick`. */
  tickMs?: number;
  /** Runs when the phase is entered, after the module's `enter` for the first declared phase. */
  onEnter?(ctx: RoundModuleContext<TSlice, TPriv, TParams>): void;
  /** Called every `tickMs` while the phase is active, with the nominal interval in ms as `dtMs`. */
  onTick?(ctx: RoundModuleContext<TSlice, TPriv, TParams>, dtMs: number): void;
  /** Required when `duration` is set. */
  onTimeout?(ctx: RoundModuleContext<TSlice, TPriv, TParams>): void;
  /** Any join, leave, connect, disconnect or ready change while in this phase. */
  onRosterChange?(ctx: RoundModuleContext<TSlice, TPriv, TParams>): void;
  /** Client actions accepted in this phase, under their unprefixed names. */
  actions?: Record<string, RoundModuleAction<TSlice, TPriv, TParams, unknown>>;
}

/**
 * A self-contained sub-game — its own phases and actions over a slice of the host's state — as
 * written by a game author and returned by {@link defineRoundModule}.
 *
 * @experimental Round module API; may change before 1.0.
 */
export interface RoundModule<TSlice, TPriv, TParams, TResult> {
  /** Identifies the module in error messages. */
  id: string;
  /** Runs when the module is entered — on entry into its first declared phase, before that phase's `onEnter`. */
  enter?(ctx: RoundModuleContext<TSlice, TPriv, TParams>): void;
  /** The module's phases, under their local (unprefixed) names. */
  phases: Record<string, RoundModulePhase<TSlice, TPriv, TParams>>;
  /** Computes the result from the slice when the module finishes; passed to the mount's `onDone`. */
  result(ctx: RoundModuleContext<TSlice, TPriv, TParams>): TResult;
}

/**
 * Options for {@link mountRoundModule}: the name prefix, the selectors from the host state and
 * private state to the module's slices, the per-run params and the finish callback.
 *
 * @experimental Round module API; may change before 1.0.
 */
export interface MountRoundModuleOptions<
  THostState extends PhaseState,
  THostPriv,
  THostOptions,
  TSlice,
  TPriv,
  TParams,
  TResult,
> {
  /** Name prefix: the module's phases become `<prefix>_<Phase>` and its actions `<PREFIX>__<ACTION>` (the prefix upper-cased). */
  prefix: string;
  /** Selects the module's slice from the host's synced state. */
  slice: (state: THostState) => TSlice;
  /** Selects the module's private slice from the host's server-only state. */
  priv: (priv: THostPriv) => TPriv;
  /** The per-run parameters, read in module hooks as `ctx.params`. */
  params: TParams;
  /** Runs when the module finishes, with the host's full context and the module's result; the host leaves the module from here. */
  onDone(ctx: GameContext<THostState, THostPriv, THostOptions>, result: TResult): void;
}

/**
 * Binds the slice, private-slice and params types once so each action infers its payload from its
 * zod schema.
 * @example const action = roundModuleActionFactory<State, Priv, Params>();
 *
 * @experimental Round module API; may change before 1.0.
 */
export function roundModuleActionFactory<TSlice, TPriv, TParams>() {
  return <TPayload>(
    spec: RoundModuleAction<TSlice, TPriv, TParams, TPayload>,
  ): RoundModuleAction<TSlice, TPriv, TParams, TPayload> => spec;
}

/**
 * Defines a round module and validates its local names at definition time: phase names follow the
 * game phase rule (`Lobby` stays reserved), action names are SCREAMING_SNAKE_CASE and none of them
 * is a reserved built-in name (a prefixed name can never equal one, so the module's own name is
 * checked).
 * @throws {GameDefinitionError} listing every problem.
 *
 * @experimental Round module API; may change before 1.0.
 */
export function defineRoundModule<TSlice, TPriv, TParams, TResult>(
  definition: RoundModule<TSlice, TPriv, TParams, TResult>,
): RoundModule<TSlice, TPriv, TParams, TResult> {
  const problems: string[] = [];
  if (!definition.id) problems.push("id must not be empty");
  const localPhases = Object.keys(definition.phases);
  if (localPhases.length === 0) problems.push("phases must not be empty");
  for (const name of localPhases) {
    if (name === LOBBY_PHASE) problems.push(`"${LOBBY_PHASE}" is reserved and built in`);
    else if (!PHASE_NAME.test(name)) problems.push(`phase name "${name}" is invalid`);
  }
  for (const phase of Object.values(definition.phases)) {
    for (const actionName of Object.keys(phase.actions ?? {})) {
      if (RESERVED_ACTIONS.includes(actionName)) {
        problems.push(`${actionName} is reserved and built in`);
      } else if (!ACTION_NAME_PATTERN.test(actionName)) {
        problems.push(`action name "${actionName}" is invalid`);
      }
    }
  }
  if (problems.length > 0) throw new GameDefinitionError(problems);
  mounts.set(definition, new Set());
  return definition;
}

/**
 * Mounts a round module under a prefix and returns the host's phase definitions to spread into
 * `GameDefinition.phases`. The module's phases become `<prefix>_<Phase>` and its actions
 * `<PREFIX>__<ACTION>` (the prefix upper-cased); both are validated here. The host enters the
 * module by transitioning to a prefixed phase name; module hooks see only their slice, private
 * slice and params, move between the module's own phases with local names, and end the run with
 * `ctx.finish()`, which runs `onDone` with the host's full context. A module can be mounted once
 * per prefix: a second mount of the same module under the same prefix throws.
 * @throws {GameDefinitionError} listing every problem.
 *
 * @experimental Round module API; may change before 1.0.
 */
export function mountRoundModule<
  THostState extends PhaseState,
  THostPriv,
  THostOptions,
  TSlice,
  TPriv,
  TParams,
  TResult,
>(
  module: RoundModule<TSlice, TPriv, TParams, TResult>,
  options: MountRoundModuleOptions<
    THostState,
    THostPriv,
    THostOptions,
    TSlice,
    TPriv,
    TParams,
    TResult
  >,
): Record<string, PhaseDefinition<THostState, THostPriv, THostOptions>> {
  const problems: string[] = [];
  if (!options.prefix) {
    problems.push("prefix must not be empty");
  } else {
    const used = mounts.get(module);
    if (used?.has(options.prefix)) {
      problems.push(`module "${module.id}" is already mounted with prefix "${options.prefix}"`);
    }
    for (const local of Object.keys(module.phases)) {
      const prefixed = `${options.prefix}_${local}`;
      if (!PHASE_NAME.test(prefixed)) problems.push(`prefixed phase name "${prefixed}" is invalid`);
    }
    for (const phase of Object.values(module.phases)) {
      for (const local of Object.keys(phase.actions ?? {})) {
        const prefixed = `${options.prefix.toUpperCase()}__${local}`;
        if (!ACTION_NAME_PATTERN.test(prefixed)) {
          problems.push(`prefixed action name "${prefixed}" is invalid`);
        }
      }
    }
  }
  if (problems.length > 0) throw new GameDefinitionError(problems);

  const { prefix, slice, priv, params, onDone } = options;
  mounts.get(module)?.add(prefix);

  const narrow = (
    host: GameContext<THostState, THostPriv, THostOptions>,
  ): RoundModuleContext<TSlice, TPriv, TParams> => ({
    state: slice(host.state),
    priv: priv(host.priv),
    params,
    phase: host.phase.slice(prefix.length + 1),
    players: () => host.players(),
    activePlayers: () => host.activePlayers(),
    player: (id) => host.player(id),
    send: (playerId, type, payload) => host.send(playerId, type, payload),
    broadcast: (type, payload) => host.broadcast(type, payload),
    showTo: (playerId, ref) => host.showTo(playerId, ref),
    hideFrom: (playerId, ref) => host.hideFrom(playerId, ref),
    transition: (local) => host.transition(`${prefix}_${local}`),
    finish: () => onDone(host, module.result(narrow(host))),
    returnToLobby: () => host.returnToLobby(),
    rng: () => host.rng(),
    newId: () => host.newId(),
    now: () => host.now(),
    log: host.log,
  });

  const entryPhase = Object.keys(module.phases)[0];
  const wrapActions = (
    actions: Record<string, RoundModuleAction<TSlice, TPriv, TParams, unknown>>,
  ): Record<string, PhaseAction<THostState, THostPriv, THostOptions>> => {
    const wrapped: Record<string, PhaseAction<THostState, THostPriv, THostOptions>> = {};
    for (const [local, action] of Object.entries(actions)) {
      wrapped[`${prefix.toUpperCase()}__${local}`] = {
        from: action.from,
        payload: action.payload,
        ...(action.textFields !== undefined ? { textFields: action.textFields } : {}),
        handler: (host) => {
          const ctx = narrow(host);
          action.handler({
            ...ctx,
            playerId: host.playerId,
            payload: host.payload,
            reject: (code, message) => host.reject(code, message),
          });
        },
      };
    }
    return wrapped;
  };

  const phases: Record<string, PhaseDefinition<THostState, THostPriv, THostOptions>> = {};
  for (const [local, phase] of Object.entries(module.phases)) {
    const wrapped: PhaseDefinition<THostState, THostPriv, THostOptions> = {
      onEnter: (host) => {
        if (local === entryPhase) module.enter?.(narrow(host));
        phase.onEnter?.(narrow(host));
      },
    };
    const duration = phase.duration;
    if (duration !== undefined) {
      wrapped.duration =
        typeof duration === "function" ? (host) => duration(narrow(host)) : duration;
    }
    if (phase.tickMs !== undefined) wrapped.tickMs = phase.tickMs;
    const onTick = phase.onTick;
    if (onTick !== undefined) wrapped.onTick = (host, dtMs) => onTick(narrow(host), dtMs);
    const onTimeout = phase.onTimeout;
    if (onTimeout !== undefined) wrapped.onTimeout = (host) => onTimeout(narrow(host));
    const onRosterChange = phase.onRosterChange;
    if (onRosterChange !== undefined)
      wrapped.onRosterChange = (host) => onRosterChange(narrow(host));
    if (phase.actions !== undefined) wrapped.actions = wrapActions(phase.actions);
    phases[`${prefix}_${local}`] = wrapped;
  }
  return phases;
}
