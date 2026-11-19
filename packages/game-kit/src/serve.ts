import type { BaseGameState } from "@openparty/shared/schema";
import { failWith } from "./fail.js";
import { hostedGame } from "./hostedGame.js";
import { bunStartServer, processIo, unavailablePrompter, unavailableRunLauncher } from "./io.js";
import type { GameDeclaration, GameKitIo } from "./types.js";

/** The `serve` entry's default io: the real process plus a lazy Bun server starter; no terminal or launcher import. */
export const serveIo: GameKitIo = {
  ...processIo(),
  prompter: unavailablePrompter("serve"),
  runLauncher: unavailableRunLauncher("serve"),
  startServer: bunStartServer,
};

/** Starts the game server for `pkg` with the ports resolved by the starter from `PORT` and `API_PORT`; a one-line `server.ts`. */
export async function serve<TState extends BaseGameState, TContent>(
  pkg: GameDeclaration<TState, TContent>,
  io: GameKitIo = serveIo,
): Promise<unknown> {
  try {
    const hosted = hostedGame(pkg, await pkg.load?.(io.env));
    return await io.startServer({
      games: [hosted],
      ...(pkg.textFilter ? { textFilter: pkg.textFilter } : {}),
    });
  } catch (error) {
    failWith(io, error);
    return undefined;
  }
}
