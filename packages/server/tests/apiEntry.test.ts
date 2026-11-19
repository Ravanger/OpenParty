import { describe, expect, it } from "vitest";
import { buildApiEntry } from "../src/apiEntry.js";
import { resolveStartOptions, type StartPorts } from "../src/resolveStartOptions.js";
import { RoomCodeService } from "../src/services/RoomCodeService.js";

const ENV: Record<string, string | undefined> = {
  HOST: "0.0.0.0",
  ALLOWED_ORIGINS: "*",
  TRUST_PROXY: "true",
};

describe("buildApiEntry vs resolveStartOptions parity", () => {
  it.each([
    ["no options, no environment", {}, {}],
    [
      "options only",
      { host: "1.2.3.4", allowedOrigins: ["http://a.example"], trustProxy: true },
      {},
    ],
    ["environment only", {}, ENV],
    [
      "explicit options over the environment",
      { host: "1.2.3.4", allowedOrigins: ["http://a.example"] },
      ENV,
    ],
  ])("resolves %s identically in both entries", (_label, options: StartPorts, env) => {
    const bun = resolveStartOptions(options, env);
    const node = buildApiEntry(options, env);
    expect(node.host).toBe(bun.host);
    expect(node.allowedOrigins).toEqual(bun.allowedOrigins);
    expect(node.trustProxy).toBe(bun.trustProxy);
  });

  it("reuses the given room-code service in both entries and creates one otherwise", () => {
    const shared = new RoomCodeService();
    expect(resolveStartOptions({ roomCodeService: shared }, {}).roomCodeService).toBe(shared);
    expect(buildApiEntry({ roomCodeService: shared }, {}).roomCodeService).toBe(shared);
    expect(resolveStartOptions({}, {}).roomCodeService).toBeInstanceOf(RoomCodeService);
    expect(buildApiEntry({}, {}).roomCodeService).toBeInstanceOf(RoomCodeService);
  });

  it("returns the throttled handler", () => {
    expect(typeof buildApiEntry({}, {}).handler).toBe("function");
  });
});

describe("buildApiEntry handler wiring", () => {
  const url = "http://127.0.0.1/api/resolve-code?code=ZZZZ";

  it("applies the resolved allowedOrigins to the handler", () => {
    const entry = buildApiEntry({ allowedOrigins: ["http://party.example"] }, {});
    const ask = (origin: string): Response =>
      entry.handler(new Request(url, { headers: { Origin: origin } }));
    expect(ask("http://party.example").headers.get("Access-Control-Allow-Origin")).toBe(
      "http://party.example",
    );
    expect(ask("http://elsewhere.example").headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("throttles /api/resolve-code with the resolved bucket per remote address", async () => {
    const entry = buildApiEntry({ rateLimits: { resolveCode: { rate: 0, burst: 1 } } }, {});
    const info = { remoteAddress: "203.0.113.7" };
    expect(entry.handler(new Request(url), info).status).toBe(404); // the one token is spent
    const refused = entry.handler(new Request(url), info);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "Too many requests" });
  });

  it("keys the throttle on X-Forwarded-For when trustProxy is resolved on", async () => {
    const entry = buildApiEntry(
      { trustProxy: true, rateLimits: { resolveCode: { rate: 0, burst: 1 } } },
      {},
    );
    const ask = (xff: string): Response =>
      entry.handler(new Request(url, { headers: { "X-Forwarded-For": xff } }));
    expect(ask("203.0.113.7").status).toBe(404); // A's one token is spent (unknown code)
    expect(ask("203.0.113.8").status).toBe(404); // B behind the same proxy: its own bucket
    expect(ask("203.0.113.7").status).toBe(429); // A's bucket is spent
  });
});
