import type { GameKitIo, ServeOptions } from "./types.js";

/** The process-level fields every entry default shares; each entry adds its own capability on top. */
export const processIo = (): Pick<
  GameKitIo,
  "env" | "argv" | "exit" | "log" | "error" | "onSignal"
> => ({
  env: process.env,
  argv: process.argv.slice(2),
  exit: process.exit,
  log: console.log,
  error: console.error,
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
});

/** A `prompter` stub for an entry's default io that has no prompter; calling it is a wiring error. */
export const unavailablePrompter = (entry: string): GameKitIo["prompter"] => {
  const fail = (): never => {
    throw new Error(`${entry} does not provide prompter`);
  };
  return fail as GameKitIo["prompter"];
};

/** A `startServer` stub for an entry's default io that has no server starter; calling it is a wiring error. */
export const unavailableStartServer = (entry: string): GameKitIo["startServer"] => {
  const fail = (): never => {
    throw new Error(`${entry} does not provide startServer`);
  };
  return fail as GameKitIo["startServer"];
};

/** A `runLauncher` stub for an entry's default io that has no launcher; calling it is a wiring error. */
export const unavailableRunLauncher = (entry: string): GameKitIo["runLauncher"] => {
  const fail = (): never => {
    throw new Error(`${entry} does not provide runLauncher`);
  };
  return fail as GameKitIo["runLauncher"];
};

/** The `serve` entry's server starter: the Bun entry, imported only when it runs. */
export const bunStartServer = async (options: ServeOptions): Promise<unknown> =>
  (await import("@openparty/server/bun")).startServer(options);
