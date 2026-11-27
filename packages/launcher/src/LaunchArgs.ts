import { between, type Parsed } from "@openparty/client-utils";
import type { BaseGameState } from "@openparty/shared/schema";
import type { LaunchConfig } from "./types.js";

const MODES = ["dev", "host", "prod"] as const;
/** How the launcher runs the game: `dev` serves the Vite dev client, `host` is dev reachable from other devices, `prod` serves the built client. */
export type LaunchMode = (typeof MODES)[number];

/** The parsed `launch` command line. */
export interface LaunchArgs {
  mode: LaunchMode;
  openBrowser: boolean;
  /** Bots to seat in a room opened for the human, when `--bots` was given. */
  bots?: number;
  /** Bots besides the host bot in a watch-only room, when `--demo` was given. */
  demo?: number;
  /** How well the bots play, 0..1, when `--bot-skill` was given; omitted keeps the bots' default of 0.5. */
  skill?: number;
}

const DEFAULT_BOTS = 3;
const DEFAULT_DEMO = 3;
const COMBINED = "--demo and --bots cannot be combined: --demo opens its own watch-only room.";

const isMode = (value: string): value is LaunchMode => MODES.some((mode) => mode === value);

const usageOf = <TState extends BaseGameState>(config: LaunchConfig<TState>): string => {
  const options = [
    ...(config.bots ? [`--bots[=1..${config.bots.max}]`] : []),
    ...(config.demo ? [`--demo[=${config.demo.min}..${config.demo.max}]`] : []),
  ];
  const extra = options.length > 0 ? ` [${options.join(" | ")}]` : "";
  const skill = config.bots !== undefined || config.demo !== undefined ? " [--bot-skill=0..1]" : "";
  return `Usage: launch [dev|host|prod] [--no-browser]${extra}${skill}`;
};

const isFlag = (flag: string, name: string): boolean =>
  flag === name || flag.startsWith(`${name}=`);

const countOf = (flag: string, fallback: number): number => Number(flag.split("=")[1] ?? fallback);

/** Parses `[dev|host|prod] [--no-browser] [--bots[=N] | --demo[=N]] [--bot-skill=<0..1>]`; the options a game does not support are refused. */
export const parseLaunchArgs = <TState extends BaseGameState>(
  argv: string[],
  config: LaunchConfig<TState>,
): Parsed<LaunchArgs> => {
  const fail = { ok: false, error: usageOf(config) } as const;
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const mode = positional[0] ?? "dev";
  const botsFlag = flags.find((flag) => isFlag(flag, "--bots"));
  const demoFlag = flags.find((flag) => isFlag(flag, "--demo"));
  const skillFlag = flags.find((flag) => isFlag(flag, "--bot-skill"));
  const unknown = flags.filter(
    (flag) =>
      flag !== "--no-browser" && flag !== botsFlag && flag !== demoFlag && flag !== skillFlag,
  );
  if (!isMode(mode) || positional.length > 1 || unknown.length > 0) return fail;

  const result: LaunchArgs = { mode, openBrowser: !flags.includes("--no-browser") };
  if (botsFlag !== undefined) {
    if (!config.bots) return fail;
    const count = countOf(botsFlag, config.bots.default ?? DEFAULT_BOTS);
    if (!between(count, 1, config.bots.max)) return fail;
    result.bots = count;
  }
  if (demoFlag !== undefined) {
    if (!config.demo) return fail;
    const { min, max } = config.demo;
    const count = countOf(demoFlag, Math.min(max, Math.max(min, DEFAULT_DEMO)));
    if (!between(count, min, max)) return fail;
    result.demo = count;
  }
  if (result.bots !== undefined && result.demo !== undefined) {
    return { ok: false, error: COMBINED };
  }
  if (skillFlag !== undefined) {
    // The flag only applies to a bot table this launch opens, on a game that has one.
    if (
      (!config.bots && !config.demo) ||
      (result.bots === undefined && result.demo === undefined)
    ) {
      return fail;
    }
    const raw = skillFlag.split("=")[1];
    // A 0..1 fraction: the integer-only `between` does not fit.
    if (raw === undefined || raw.trim() === "") return fail;
    const skill = Number(raw);
    if (!Number.isFinite(skill) || skill < 0 || skill > 1) return fail;
    result.skill = skill;
  }
  return { ok: true, value: result };
};
