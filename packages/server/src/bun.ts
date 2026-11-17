import { BunWebSockets } from "@colyseus/bun-websockets";
// @ts-expect-error - Bun ships no TypeScript declarations in this repo
import { serve } from "bun";
import { buildApiEntry } from "./apiEntry.js";
import {
  createGameServer,
  DEFAULT_MAX_PAYLOAD_BYTES,
  type GameServerOptions,
} from "./createGameServer.js";
import { resolveStartOptions, type StartPorts } from "./resolveStartOptions.js";

/** Options for `startServer`: the `GameServerOptions` (minus `transport`) plus the listening ports. */
export type StartServerOptions = Omit<GameServerOptions, "transport"> & StartPorts;

/** Bun entry point: WebSocket game server plus the code-resolution API. */
export async function startServer(options: StartServerOptions) {
  const resolved = resolveStartOptions(options, process.env);
  const { port, apiPort } = resolved;
  const { handler, host } = buildApiEntry(resolved, process.env);
  const server = createGameServer({
    ...options,
    roomCodeService: resolved.roomCodeService,
    transport: new BunWebSockets({
      path: "/",
      maxPayloadLength: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    }),
  });
  let api: ReturnType<typeof serve>;
  api = serve({
    port: apiPort,
    hostname: host ?? "127.0.0.1",
    fetch: (req: Request) => {
      const remoteAddress = api?.requestIP(req)?.address;
      return handler(req, remoteAddress === undefined ? {} : { remoteAddress });
    },
  });
  try {
    await server.listen(port);
  } catch (error) {
    // A failed game-server bind must not leave the code API listening.
    api.stop();
    throw error;
  }
  return { server, api };
}
