import type { TextFilter } from "@openparty/content/filter";
import { ErrorCode } from "@openparty/shared";
import type { MiddlewareContext, PhaseMiddleware, PhaseState } from "../runtime/index.js";

/** Options for {@link textFilterMiddleware}. */
export interface TextFilterMiddlewareOptions {
  /**
   * Called when the filter refuses an action, after the rejection is recorded, with the filter's
   * reason. The game can react (e.g. count rejections); it cannot change the outcome.
   */
  onRejected?(ctx: MiddlewareContext<PhaseState, unknown, unknown>, reason: string): void;
}

/**
 * Rejects actions whose declared text fields fail the room's filter level — player and audience
 * actions alike. For an `action` event with `textFields`, runs `filter.check(value, level)` on each
 * named string field of the payload in declaration order and, on the first failure, rejects with
 * `CONTENT_REJECTED` and the fixed core string (`CoreStrings.contentRejected`, default
 * `CLIENT_MESSAGES.CONTENT_REJECTED`) — always with `redactPayload: true`, so an action log records
 * the rejection without the offending text — skipping the rest of the chain (the handler never
 * runs). The filter's own reason never reaches a client; it is passed only to `onRejected`. Pass
 * `onRejected` to be told about each refusal. Actions without `textFields`, declared fields that
 * are not strings, and a level of `"off"` (the default) pass untouched; at `"off"` the filter is
 * never called.
 */
export function textFilterMiddleware(
  filter: TextFilter,
  options?: TextFilterMiddlewareOptions,
): PhaseMiddleware<PhaseState, unknown, unknown> {
  const onRejected = options?.onRejected;
  return (ctx, next) => {
    const event = ctx.event;
    if (event.kind === "action" && event.filterLevel !== "off") {
      for (const field of event.textFields ?? []) {
        const value = (event.payload as Record<string, unknown>)[field];
        if (typeof value !== "string") continue;
        const result = filter.check(value, event.filterLevel);
        if (!result.ok) {
          ctx.reject(ErrorCode.CONTENT_REJECTED, ctx.strings.contentRejected, {
            redactPayload: true,
          });
          onRejected?.(ctx, result.reason);
          return;
        }
      }
    }
    next();
  };
}
