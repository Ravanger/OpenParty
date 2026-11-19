import { isServerError, type ServerError } from "@openparty/shared";

/**
 * The validated outcome of an `EXPORT_REPLAY` reply: `bundle` is a well-formed replay bundle
 * exactly as the server sent it, `refused` is the server's own well-formed refusal, and
 * `bad-reply` is anything else (which must never reach the client as-is).
 */
export type ExportReplayReply =
  | { kind: "bundle"; bundle: Record<string, unknown> }
  | { kind: "refused"; error: ServerError }
  | { kind: "bad-reply" };

/** Validates a raw `EXPORT_REPLAY` reply; a refusal is trusted only when it carries a well-formed server error, and a bundle only when it has both a number `bundleVersion` and an array `snapshots`. */
export function parseExportReplay(response: unknown): ExportReplayReply {
  if (response === null || typeof response !== "object" || Array.isArray(response)) {
    return { kind: "bad-reply" };
  }
  const reply = response as Record<string, unknown>;
  if (reply.ok === false) {
    if (!isServerError(reply.error)) return { kind: "bad-reply" };
    return { kind: "refused", error: reply.error };
  }
  if (typeof reply.bundleVersion !== "number" || !Array.isArray(reply.snapshots)) {
    return { kind: "bad-reply" };
  }
  return { kind: "bundle", bundle: reply };
}
