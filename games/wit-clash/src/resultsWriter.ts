import { pickBestAnswers } from "./bestAnswers.js";
import { pickHighlights } from "./highlights.js";
import type { WitClashContext } from "./private.js";
import { composeScoreboard } from "./scoreboard.js";
import { BestAnswer, Highlight, HighlightAnswer, ScoreEntry } from "./state.js";

/** Writes the shared rules' results into the synced state. One per hook call; holds no state of its own. */
export class ResultsWriter {
  constructor(private readonly ctx: WitClashContext) {}

  writeBestAnswers(): void {
    const { state, priv } = this.ctx;
    state.bestAnswers.clear();
    for (const record of pickBestAnswers(priv.answerHistory)) {
      const { text, authorId, authorName, promptText, votes } = record;
      state.bestAnswers.push(
        Object.assign(new BestAnswer(), { text, authorId, authorName, promptText, votes }),
      );
    }
  }

  writeHighlights(): void {
    const { state, priv } = this.ctx;
    state.highlights.clear();
    const picked = pickHighlights(priv.answerHistory);
    for (const list of [picked.biggestMargin, picked.closestMatch, picked.fastestAnswer]) {
      if (list === undefined) continue;
      for (const item of list) {
        const entry = Object.assign(new Highlight(), {
          kind: item.kind,
          promptText: item.promptText,
        });
        for (const answer of item.answers)
          entry.answers.push(Object.assign(new HighlightAnswer(), answer));
        state.highlights.push(entry);
      }
    }
  }

  writeScoreboard(): void {
    const { state, priv } = this.ctx;
    priv.roster.remember(this.ctx);
    const seated = this.ctx.players();
    const rows = composeScoreboard({
      scores: priv.scores,
      awards: priv.roundAwards,
      tieBreakerWinnerId: priv.tieBreakerWinnerId,
      activeIds: seated.filter((p) => p.isActive && p.isReady).map((p) => p.id),
      seatedNames: new Map(seated.map((p) => [p.id, p.name])),
      rememberedNames: priv.roster.rememberedNames,
      participantIds: priv.roster.participantIds,
    });
    state.scoreboard.clear();
    for (const row of rows) state.scoreboard.push(Object.assign(new ScoreEntry(), row));
  }
}
