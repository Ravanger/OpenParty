import { runLauncher } from "@openparty/launcher";
import type { BaseGameState } from "@openparty/shared/schema";
import { processIo, unavailablePrompter, unavailableStartServer } from "./io.js";
import { buildLaunchConfig } from "./launchConfig.js";
import type { GameDeclaration, GameKitIo } from "./types.js";

/** The `launch` entry's default io: the real process plus the launcher; no terminal import. */
export const launchIo: GameKitIo = {
  ...processIo(),
  prompter: unavailablePrompter("launch"),
  startServer: unavailableStartServer("launch"),
  runLauncher,
};

/** Runs the launcher with the config built from `pkg`; a one-line `launch.ts`. */
export async function launch<TState extends BaseGameState, TContent>(
  pkg: GameDeclaration<TState, TContent>,
  options: { gameDir: string },
  io: GameKitIo = launchIo,
): Promise<void> {
  const config = buildLaunchConfig(pkg, options);
  await io.runLauncher(config, io.argv);
}
