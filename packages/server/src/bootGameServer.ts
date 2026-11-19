import { createGameServer, type GameServerOptions } from "./createGameServer.js";
import { type GameColyseusServer, listenGameServer } from "./gameTransport.js";

/** Creates the game server for `options` and listens it on `port`; a failed bind shuts the half-booted server down, leaving nothing listening. */
export async function bootGameServer(
  options: GameServerOptions,
  port: number,
): Promise<GameColyseusServer> {
  const server = createGameServer(options);
  await listenGameServer(server, port);
  return server;
}
