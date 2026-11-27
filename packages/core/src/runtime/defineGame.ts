import {
  ACTION_NAME_PATTERN,
  END_GAME,
  KICK_PLAYER,
  LOBBY_PHASE,
  PAUSE_GAME,
  RESUME_GAME,
  SET_OPTIONS,
  START_GAME,
} from "@openparty/shared";
import {
  isRoundModuleMountInfo,
  type RoundModuleMountInfo,
  roundModuleMounts,
} from "./roundModuleMount.js";
import { mergeCoreStrings } from "./strings.js";
import type {
  ActionDefinition,
  ActionRateLimit,
  AudienceActionDefinition,
  GameDefinition,
  PhaseState,
} from "./types.js";

const PHASE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED_ACTIONS: readonly string[] = [
  START_GAME,
  KICK_PLAYER,
  SET_OPTIONS,
  END_GAME,
  PAUSE_GAME,
  RESUME_GAME,
];

/**
 * The hard ceiling every declared action `rateLimit` is validated against at definition time, so a
 * game cannot ask the server for an unbounded bucket (10× the default action limit).
 */
export const ACTION_RATE_LIMIT_CEILING = { rate: 100, burst: 200 } as const;

/** Thrown by {@link defineGame}; the message lists every problem found. */
export class GameDefinitionError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid game definition:\n- ${problems.join("\n- ")}`);
    this.name = "GameDefinitionError";
  }
}

/** Problems with one action's declared `rateLimit`, if any: its shape, then the server ceiling. */
function rateLimitProblems(action: string, limit: ActionRateLimit | undefined): string[] {
  if (limit === undefined) return [];
  const problems: string[] = [];
  if (!Number.isFinite(limit.rate) || limit.rate <= 0) {
    problems.push(`action "${action}" has an invalid rateLimit rate (must be a finite number > 0)`);
  } else if (limit.rate > ACTION_RATE_LIMIT_CEILING.rate) {
    problems.push(
      `action "${action}" declares a rateLimit rate above the ceiling (max ${ACTION_RATE_LIMIT_CEILING.rate}/s)`,
    );
  }
  if (!Number.isInteger(limit.burst) || limit.burst < 1) {
    problems.push(`action "${action}" has an invalid rateLimit burst (must be an integer >= 1)`);
  } else if (limit.burst > ACTION_RATE_LIMIT_CEILING.burst) {
    problems.push(
      `action "${action}" declares a rateLimit burst above the ceiling (max ${ACTION_RATE_LIMIT_CEILING.burst})`,
    );
  }
  return problems;
}

/**
 * Validates a game definition, fills its `strings` with the merged table (mutating the spec),
 * and returns it typed.
 * @throws {GameDefinitionError} listing every problem.
 */
export function defineGame<
  TState extends PhaseState,
  TPrivate = Record<string, never>,
  TOptions = Record<string, unknown>,
>(spec: GameDefinition<TState, TPrivate, TOptions>): GameDefinition<TState, TPrivate, TOptions> {
  const problems: string[] = [];
  if (!spec.name) problems.push("name must not be empty");
  if (!spec.version) problems.push("version must not be empty");
  if (!Number.isInteger(spec.minPlayers) || spec.minPlayers < 1) {
    problems.push("minPlayers must be an integer >= 1");
  }
  if (!Number.isInteger(spec.maxPlayers) || spec.maxPlayers < 1) {
    problems.push("maxPlayers must be an integer >= 1");
  }
  if (spec.maxPlayers < spec.minPlayers) problems.push("maxPlayers must be >= minPlayers");
  if (!Object.hasOwn(spec.phases, spec.startPhase)) {
    problems.push(`startPhase "${spec.startPhase}" is not a declared phase`);
  }
  for (const [name, phase] of Object.entries(spec.phases)) {
    if (name === LOBBY_PHASE) problems.push(`"${LOBBY_PHASE}" is reserved and built in`);
    else if (!PHASE_NAME.test(name)) problems.push(`phase name "${name}" is invalid`);
    if (phase.duration !== undefined && !phase.onTimeout) {
      problems.push(`phase "${name}" has a duration but no onTimeout`);
    }
    if (
      typeof phase.duration === "number" &&
      (!Number.isFinite(phase.duration) || phase.duration <= 0)
    ) {
      problems.push(`phase "${name}" has an invalid duration (must be a finite number > 0)`);
    }
    if (phase.tickMs !== undefined && phase.onTick === undefined) {
      problems.push(`phase "${name}" has a tickMs but no onTick`);
    }
    if (phase.tickMs !== undefined && (!Number.isInteger(phase.tickMs) || phase.tickMs < 1)) {
      problems.push(`phase "${name}" has an invalid tickMs (must be an integer >= 1)`);
    }
    for (const [action, definition] of Object.entries(phase.actions ?? {})) {
      if (RESERVED_ACTIONS.includes(action)) problems.push(`${action} is reserved and built in`);
      else if (!ACTION_NAME_PATTERN.test(action))
        problems.push(`action name "${action}" is invalid`);
      problems.push(...rateLimitProblems(action, definition.rateLimit));
    }
  }
  // Round-module overlaps: a prefix claimed by two mounts, or a claim shadowed by the game's
  // own phase or by the spread losing the mount's wrapped phase.
  const mounts = roundModuleMounts(spec.phases);
  for (let i = 0; i < mounts.length; ++i) {
    for (let j = i + 1; j < mounts.length; ++j) {
      const [, a] = mounts[i] as [symbol, RoundModuleMountInfo];
      const [, b] = mounts[j] as [symbol, RoundModuleMountInfo];
      if (a.prefix === b.prefix) {
        if (a.moduleId === b.moduleId) {
          problems.push(`module "${a.moduleId}" is already mounted with prefix "${a.prefix}"`);
        } else {
          problems.push(
            `modules "${a.moduleId}" and "${b.moduleId}" are mounted with the same prefix "${a.prefix}"`,
          );
        }
      }
    }
  }
  for (const [mountKey, mount] of mounts) {
    for (const name of mount.phaseNames) {
      const phase = spec.phases[name];
      if (phase === undefined) {
        problems.push(
          `module "${mount.moduleId}" mounts phase "${name}" but the game declares no such phase`,
        );
        continue;
      }
      if (Object.getOwnPropertySymbols(phase).includes(mountKey)) continue;
      // A phase at the claimed name that is neither this mount's nor another mount's is a game-
      // declared phase shadowing the module's phase. A phase that is another mount's is the
      // prefix collision already reported above.
      const phaseMounts = Object.getOwnPropertySymbols(phase).filter((symbol) =>
        isRoundModuleMountInfo((phase as Record<symbol, unknown>)[symbol]),
      );
      if (phaseMounts.length === 0) {
        problems.push(
          `module "${mount.moduleId}" mounts phase "${name}" but the game declares its own phase with that name`,
        );
      }
    }
  }
  const middleware: unknown = spec.middleware;
  if (middleware !== undefined) {
    if (!Array.isArray(middleware)) problems.push("middleware must be an array of functions");
    else
      for (const [i, layer] of middleware.entries()) {
        if (typeof layer !== "function") problems.push(`middleware[${i}] is not a function`);
      }
  }
  if (problems.length > 0) throw new GameDefinitionError(problems);
  spec.strings = mergeCoreStrings(spec.strings);
  return spec;
}

/**
 * Binds the state, private-state and options types once so each action infers its payload from its zod schema.
 * Accepts a seated player's action (`from: "host" | "player"`) or an audience one (`from: "audience"`);
 * the handler's context is typed to match.
 * @example const action = actionFactory<State, Priv, Options>();
 */
export function actionFactory<TState extends PhaseState, TPrivate, TOptions>() {
  return <TPayload>(
    spec:
      | ActionDefinition<TState, TPrivate, TOptions, TPayload>
      | AudienceActionDefinition<TState, TPrivate, TOptions, TPayload>,
  ):
    | ActionDefinition<TState, TPrivate, TOptions, TPayload>
    | AudienceActionDefinition<TState, TPrivate, TOptions, TPayload> => spec;
}
