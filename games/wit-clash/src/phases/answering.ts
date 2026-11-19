import { ensureMine } from "@openparty/core";
import { allResponded } from "@openparty/core/kits";
import { ErrorCode } from "@openparty/shared";
import { ACTION, defineAction, SetTypingSchema, SubmitAnswerSchema } from "../actions.js";
import type { WitClashContext, WitClashPhase } from "../private.js";
import { newPlayerPrivate } from "../round.js";

export const answersComplete = (ctx: WitClashContext): boolean =>
  allResponded(
    ctx.priv.assignments,
    ctx.priv.drafts,
    new Set(ctx.activePlayers().map((p) => p.id)),
  );

export function answeringActions(
  finish: (ctx: WitClashContext) => void,
): NonNullable<WitClashPhase["actions"]> {
  return {
    [ACTION.SUBMIT_ANSWER]: defineAction({
      from: "player",
      payload: SubmitAnswerSchema,
      textFields: ["answer"],
      handler: (ctx) => {
        const { matchupId, answer } = ctx.payload;
        const assigned = ctx.priv.assignments.get(ctx.playerId);
        if (!assigned?.includes(matchupId)) {
          ctx.reject(ErrorCode.NOT_ALLOWED, "That prompt was not assigned to you");
          return;
        }
        const drafts = ctx.priv.drafts.get(ctx.playerId) ?? new Map<string, string>();
        ctx.priv.drafts.set(ctx.playerId, drafts.set(matchupId, answer));
        // The phase start is the deadline minus the published duration, so the time tracks the real window.
        const startedAt = ctx.state.phaseEndsAt - ctx.state.phaseDurationMs;
        const times = ctx.priv.submitTimes.get(ctx.playerId) ?? new Map<string, number>();
        ctx.priv.submitTimes.set(
          ctx.playerId,
          times.set(matchupId, Math.max(0, ctx.now() - startedAt)),
        );
        ctx.state.progress.set(ctx.playerId, drafts.size);
        const mine = ensureMine(ctx, ctx.state.mine, ctx.playerId, newPlayerPrivate);
        const prompt = mine.prompts.find((p) => p.matchupId === matchupId);
        if (prompt) prompt.submitted = true;
        if (drafts.size >= assigned.length) ctx.state.typing.delete(ctx.playerId);
        if (answersComplete(ctx)) finish(ctx);
      },
    }),
    [ACTION.SET_TYPING]: defineAction({
      from: "player",
      payload: SetTypingSchema,
      handler: (ctx) => {
        if (!ctx.priv.assignments.has(ctx.playerId)) {
          ctx.reject(ErrorCode.NOT_ALLOWED, "You have nothing to answer");
          return;
        }
        if (ctx.payload.typing) ctx.state.typing.set(ctx.playerId, true);
        else ctx.state.typing.delete(ctx.playerId);
      },
    }),
  };
}
