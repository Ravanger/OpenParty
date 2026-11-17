import { EmptyPayloadSchema, playAgainAction } from "@openparty/core";
import { ErrorCode } from "@openparty/shared";
import { ACTION, defineAction } from "../actions.js";
import { writeAwards } from "../awards.js";
import { PHASE } from "../phaseNames.js";
import type { WitClashPhase } from "../private.js";
import { ResultsWriter } from "../resultsWriter.js";
import { Round } from "../round.js";

export const Results: WitClashPhase = {
  onEnter: (ctx) => {
    ctx.state.isFinalRound = ctx.state.roundNumber >= ctx.state.totalRounds;
    const writer = new ResultsWriter(ctx);
    writer.writeScoreboard();
    if (ctx.state.isFinalRound) {
      writer.writeBestAnswers();
      writer.writeHighlights();
      writeAwards(ctx);
    }
  },
  onRosterChange: (ctx) => {
    new Round(ctx).pruneDeparted();
    new ResultsWriter(ctx).writeScoreboard();
  },
  actions: {
    [ACTION.NEXT_ROUND]: defineAction({
      from: "host",
      payload: EmptyPayloadSchema,
      handler: (ctx) => {
        if (ctx.state.isFinalRound) {
          ctx.reject(ErrorCode.NOT_ALLOWED, "That was the final round");
          return;
        }
        ctx.transition(PHASE.CategorySelection);
      },
    }),
    [ACTION.PLAY_AGAIN]: playAgainAction(),
  },
};
