import type { Logger } from "@openparty/core";
import { type ApiRequestInfo, createApiHandler } from "./api/createApiHandler.js";
import { createResolveCodeThrottle } from "./createGameServer.js";
import type { RateLimits } from "./RateLimiter.js";
import { resolveBindOptions } from "./resolveStartOptions.js";
import { RoomCodeService } from "./services/RoomCodeService.js";

/** Options the entries hand to {@link buildApiEntry}: everything the code API needs before it binds. */
export interface ApiEntryOptions {
  /** Shared room-code service; a fresh one when omitted. */
  roomCodeService?: RoomCodeService;
  /** Interface the code API binds; loopback when omitted (or `HOST`). */
  host?: string;
  /** Origins allowed to read the code API; loopback only when omitted (or `ALLOWED_ORIGINS`). */
  allowedOrigins?: string[] | "*";
  /** Throttle `/api/resolve-code` per remote address with these limits (429 + `Retry-After`). */
  rateLimits?: RateLimits;
  /** Key the throttle on the last hop of `X-Forwarded-For`; only behind a trusted reverse proxy (or `TRUST_PROXY`). */
  trustProxy?: boolean;
  /** Where observe-mode limit hits are logged; `console.warn` when omitted. */
  logger?: Logger;
}

/** The code API built but not yet bound: the room-code service, the throttled `createApiHandler` handler and the resolved bind options. Both runtime entries build it once, so they cannot drift apart. */
export function buildApiEntry(
  options: ApiEntryOptions,
  env: Record<string, string | undefined>,
): {
  roomCodeService: RoomCodeService;
  handler: (req: Request, info?: ApiRequestInfo) => Response;
  host?: string;
  allowedOrigins?: string[] | "*";
  trustProxy?: boolean;
} {
  const bind = resolveBindOptions(options, env);
  const roomCodeService = options.roomCodeService ?? new RoomCodeService();
  const { limiter, bucket } = createResolveCodeThrottle(options.rateLimits, options.logger);
  return {
    ...bind,
    roomCodeService,
    handler: createApiHandler(roomCodeService, {
      ...(bind.allowedOrigins !== undefined ? { allowedOrigins: bind.allowedOrigins } : {}),
      ...(bind.trustProxy !== undefined ? { trustProxy: bind.trustProxy } : {}),
      limiter,
      resolveCode: bucket,
    }),
  };
}
