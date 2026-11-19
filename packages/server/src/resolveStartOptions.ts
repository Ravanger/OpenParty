import { z } from "zod";
import { RoomCodeService } from "./services/RoomCodeService.js";

export interface StartPorts {
  /** Defaults to `PORT` or 2567. */
  port?: number;
  /** Code-resolution HTTP API. Defaults to `API_PORT` or 3001. */
  apiPort?: number;
  roomCodeService?: RoomCodeService;
  /** Interface the code API binds; loopback when omitted. */
  host?: string;
  /** Origins allowed to read the code API; loopback only when omitted. */
  allowedOrigins?: string[] | "*";
  /** Key the code API's throttle on `X-Forwarded-For`; only behind a trusted reverse proxy. */
  trustProxy?: boolean;
}

const portFrom = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .safeParse(raw);
  if (!parsed.success) throw new Error(`${name} must be a whole number from 1 to 65535`);
  return parsed.data;
};

/** `HOST` from the environment: an interface to bind, or undefined (the loopback default) when unset or empty. */
function hostFrom(raw: string | undefined): string | undefined {
  return raw === undefined || raw === "" ? undefined : raw;
}

/** `ALLOWED_ORIGINS` from the environment: a comma-separated origin list, `"*"` for all origins, or undefined (the loopback default) when unset or blank. */
function parseAllowedOrigins(raw: string | undefined): string[] | "*" | undefined {
  if (raw === undefined) return undefined;
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  if (origins.length === 0) return undefined;
  return origins.length === 1 && origins[0] === "*" ? "*" : origins;
}

/** `TRUST_PROXY` from the environment: true only for the exact string `"true"` — anything else leaves it off. */
function trustProxyFrom(raw: string | undefined): boolean | undefined {
  return raw === "true" ? true : undefined;
}

/** `host`, `allowedOrigins` and `trustProxy` from options or the environment, in one place for every entry. */
export function resolveBindOptions(
  options: { host?: string; allowedOrigins?: string[] | "*"; trustProxy?: boolean },
  env: Record<string, string | undefined>,
): { host?: string; allowedOrigins?: string[] | "*"; trustProxy?: boolean } {
  const host = options.host ?? hostFrom(env.HOST);
  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const trustProxy = options.trustProxy ?? trustProxyFrom(env.TRUST_PROXY);
  return {
    ...(host !== undefined ? { host } : {}),
    ...(allowedOrigins !== undefined ? { allowedOrigins } : {}),
    ...(trustProxy !== undefined ? { trustProxy } : {}),
  };
}

/** Fills in the ports, the bind interface and the shared room-code service for `startServer`. */
export function resolveStartOptions(
  options: StartPorts,
  env: Record<string, string | undefined>,
): {
  port: number;
  apiPort: number;
  roomCodeService: RoomCodeService;
  host?: string;
  allowedOrigins?: string[] | "*";
  trustProxy?: boolean;
} {
  return {
    ...resolveBindOptions(options, env),
    port: options.port ?? portFrom("PORT", env.PORT, 2567),
    apiPort: options.apiPort ?? portFrom("API_PORT", env.API_PORT, 3001),
    roomCodeService: options.roomCodeService ?? new RoomCodeService(),
  };
}
