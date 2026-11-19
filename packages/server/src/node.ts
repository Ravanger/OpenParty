import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { Server } from "@colyseus/core";
import type { Logger } from "@openparty/core";
import type { ApiRequestInfo } from "./api/createApiHandler.js";
import { buildApiEntry } from "./apiEntry.js";
import { bootGameServer } from "./bootGameServer.js";
import type { GameServerOptions } from "./createGameServer.js";
import { toFetchRequest, writeNodeResponse } from "./nodeHttpAdapter.js";
import { closeHttpServer, freePort } from "./probe.js";
import type { RateLimits } from "./RateLimiter.js";
import type { RoomCodeService } from "./services/RoomCodeService.js";

/** Options for `serveApi`. */
export interface ServeApiOptions {
  port: number;
  /** Interface to bind; loopback when omitted. */
  host?: string;
  /** Origins allowed to read the API; loopback only when omitted. */
  allowedOrigins?: string[] | "*";
  /** Throttle `/api/resolve-code` per remote address with these limits (429 + `Retry-After`). */
  rateLimits?: RateLimits;
  /** Key the throttle on the last hop of `X-Forwarded-For`; only behind a trusted reverse proxy. */
  trustProxy?: boolean;
  /** Where observe-mode limit hits are logged; `console.warn` when omitted. */
  logger?: Logger;
  /** Replaces the default handler, which `buildApiEntry` builds from the other options. */
  handler?: (req: Request, info?: ApiRequestInfo) => Response;
}

/**
 * Serves `/api/resolve-code` for `codes` on Node's `http` (the Bun entry has its own). Close the
 * returned server to stop it. Requests Node's parser accepts but the `Request` constructor forbids
 * (methods such as `TRACE`) get a 405, and a handler failure gets a fixed 500 JSON body: the
 * exception is logged, never sent to the client, and the server keeps serving.
 */
export async function serveApi(
  codes: RoomCodeService,
  options: ServeApiOptions,
): Promise<HttpServer> {
  const handler =
    options.handler ??
    buildApiEntry(
      {
        roomCodeService: codes,
        ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
        ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
        ...(options.rateLimits !== undefined ? { rateLimits: options.rateLimits } : {}),
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
      },
      {},
    ).handler;
  const api = createHttpServer(async (req, res) => {
    const fail = (status: number, message: string): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    };
    try {
      // A connection that reached this handler has a peer address; the assertion keeps that branch out of coverage.
      const remoteAddress = req.socket.remoteAddress as string;
      const request = toFetchRequest(req);
      if (request === undefined) {
        fail(405, "Method not allowed");
        return;
      }
      const response = handler(request, { remoteAddress });
      await writeNodeResponse(res, response);
    } catch (error) {
      // A throwing handler must not take the process down with an unhandled rejection: a fixed
      // body goes to the client and the exception to the log, never its text to the wire.
      console.error("[api] request failed", error);
      fail(500, "Internal server error");
    }
  });
  await new Promise<void>((resolve, reject) => {
    api.once("error", reject);
    api.listen(options.port, options.host ?? "127.0.0.1", resolve);
  });
  return api;
}

/** Options for `startNodeServer`: the `GameServerOptions` (minus `transport`) plus ports and API access. */
export interface NodeServerOptions extends Omit<GameServerOptions, "transport"> {
  /** Game server port; a free one when omitted. */
  port?: number;
  /** Code API port; a free one when omitted. */
  apiPort?: number;
  /** Interface the code API binds; loopback (or `HOST`) when omitted. */
  host?: string;
  /** Origins allowed to read the code API; loopback only (or `ALLOWED_ORIGINS`) when omitted. */
  allowedOrigins?: string[] | "*";
  /** Key the code API's throttle on `X-Forwarded-For`; only behind a trusted reverse proxy (or `TRUST_PROXY`). */
  trustProxy?: boolean;
}

/** A game server and its code API running in this process. */
export class NodeServerHandle {
  private stopped = false;

  constructor(
    readonly server: Server,
    private readonly api: HttpServer,
    readonly roomCodeService: RoomCodeService,
    readonly port: number,
    readonly apiPort: number,
  ) {}

  /** The WebSocket URL a client connects to. */
  get endpoint(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  /** Closes the API and the game server; calling it again does nothing. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.api.closeAllConnections();
    await closeHttpServer(this.api);
    await this.server.gracefullyShutdown(false);
  }
}

const MAX_PORT_ATTEMPTS = 5;

/** True for the EADDRINUSE a failed bind reports when a free port was taken after we discovered it. */
function isEaddrinuse(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "EADDRINUSE";
}

/** Runs the game server and its code API in this process, on the given ports or free ones. A free port that gets taken in the meantime is re-rolled (up to five attempts); a given port that is taken rejects immediately, leaving nothing open either way. */
export async function startNodeServer(
  options: NodeServerOptions,
  /** Test seam: overrides how free ports are discovered. */
  hooks?: { freePort?: () => Promise<number> },
): Promise<NodeServerHandle> {
  const { port: wantedPort, apiPort: wantedApiPort, ...serverOptions } = options;
  if (wantedPort !== undefined && wantedPort === wantedApiPort) {
    throw new Error("The game server and the code API need different ports");
  }
  // One entry builds the service, the handler and the bind options; unset bind options fall back to the environment, so a launcher can steer the bind with HOST/ALLOWED_ORIGINS/TRUST_PROXY.
  const entry = buildApiEntry(serverOptions, process.env);
  const discoverFreePort = hooks?.freePort ?? freePort;
  for (let attempt = 1; ; ++attempt) {
    const port = wantedPort ?? (await discoverFreePort());
    const apiPort = wantedApiPort ?? (await discoverFreePort());
    let api: HttpServer | undefined;
    try {
      api = await serveApi(entry.roomCodeService, {
        port: apiPort,
        ...(entry.host !== undefined ? { host: entry.host } : {}),
        handler: entry.handler,
      });
      const server = await bootGameServer(
        { ...serverOptions, roomCodeService: entry.roomCodeService },
        port,
      );
      return new NodeServerHandle(server, api, entry.roomCodeService, port, apiPort);
    } catch (error) {
      // A failed bind shuts the game server down itself; only the API needs closing here.
      if (api !== undefined) {
        const openApi = api;
        openApi.closeAllConnections();
        await closeHttpServer(openApi);
      }
      const retriable =
        isEaddrinuse(error) && wantedPort === undefined && wantedApiPort === undefined;
      if (!retriable || attempt === MAX_PORT_ATTEMPTS) throw error;
    }
  }
}
