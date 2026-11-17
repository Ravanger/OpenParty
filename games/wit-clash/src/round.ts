import { pruneMine, required, resetMine } from "@openparty/core";
import { eligibleVoterIds, seatedActiveIds } from "./eligibility.js";
import { META } from "./meta.js";
import { PHASE } from "./phaseNames.js";
import type { WitClashContext } from "./private.js";
import { ResultsWriter } from "./resultsWriter.js";
import type { Matchup } from "./state.js";
import { VotingSync } from "./votingSync.js";

export const PLACEHOLDER_TEXT = "(no answer)";

/** The lobby notice when a departure drops the room below its minimum. */
export const TOO_FEW_PLAYERS_NOTICE = `Fewer than ${META.minPlayers} players were left, so the game ended.`;

/** A fresh private entry for a player; defined in `votingSync.js`, re-exported for the other call sites. */
export { newPlayerPrivate } from "./votingSync.js";

/** The author of an answer, by its id; throws when the answer was never recorded. */
export function answerAuthor(ctx: WitClashContext, answerId: string): string {
  return required(ctx.priv.authors.get(answerId), "answer author");
}

/** End-of-round flow and resets for the shared rules; result writing lives in {@link ResultsWriter}. */
export class Round {
  constructor(private readonly ctx: WitClashContext) {}

  pruneDeparted(): void {
    const { state } = this.ctx;
    const departed = pruneMine(this.ctx, state.mine, [
      ...state.mine.keys(),
      ...state.progress.keys(),
      ...state.typing.keys(),
    ]);
    for (const playerId of departed) {
      state.progress.delete(playerId);
      state.typing.delete(playerId);
    }
  }

  clearTyping(): void {
    this.ctx.state.typing.clear();
  }

  /** The end of a round: on the final round, the optional honor vote before Results; otherwise straight to Results. */
  toResults(): void {
    const { state } = this.ctx;
    if (state.roundNumber >= state.totalRounds && this.ctx.options.honorVote) {
      const writer = new ResultsWriter(this.ctx);
      writer.writeBestAnswers();
      writer.writeHighlights();
      if (state.bestAnswers.length > 0) {
        this.ctx.transition(PHASE.HonorVote);
        return;
      }
    }
    this.ctx.transition(PHASE.Results);
  }

  activeMatchup(): Matchup {
    return required(this.ctx.state.matchups[this.ctx.state.activeMatchupIndex], "active matchup");
  }

  authorOf(answerId: string): string {
    return answerAuthor(this.ctx, answerId);
  }

  authorIds(matchup: Matchup): string[] {
    return matchup.answers.map((a) => this.authorOf(a.id));
  }

  eligibleVoterIds(): string[] {
    const matchup = this.activeMatchup();
    const activeIds = this.ctx.activePlayers().map((p) => p.id);
    return eligibleVoterIds(activeIds, this.authorIds(matchup), matchup.isForfeit);
  }

  /** The seated players who may have voted, connected or not; a dropped connection is not a departure. */
  tallyVoterIds(): string[] {
    const matchup = this.activeMatchup();
    return eligibleVoterIds(
      seatedActiveIds(this.ctx.players()),
      this.authorIds(matchup),
      matchup.isForfeit,
    );
  }

  syncVoting(): void {
    const eligible = this.eligibleVoterIds();
    const authors = new Set(this.authorIds(this.activeMatchup()));
    new VotingSync(this.ctx, {
      mayVote: (id) => eligible.includes(id),
      flags: (id, mine) => {
        mine.isOwnMatchup = authors.has(id);
      },
    }).run();
  }

  clearRound(): void {
    const { state, priv } = this.ctx;
    priv.clearRound();
    resetMine(this.ctx, state.mine);
    state.selectedCategory = "";
    state.categoryOptions.clear();
    state.matchups.clear();
    state.scoreboard.clear();
    state.progress.clear();
    state.typing.clear();
    state.tieBreakers.clear();
    state.tieBreakerContenders.clear();
    state.answersPerPlayer = 0;
    state.activeMatchupIndex = -1;
    state.votesCast = 0;
    state.votesExpected = 0;
    state.isFinalRound = false;
  }

  clearGame(): void {
    this.clearRound();
    this.ctx.priv.clearGame();
    this.ctx.state.bestAnswers.clear();
    this.ctx.state.highlights.clear();
    this.ctx.state.awards.clear();
    this.ctx.state.honorWinnerNames.clear();
    this.ctx.state.roundNumber = 0;
    this.ctx.state.totalRounds = this.ctx.options.totalRounds;
    this.ctx.state.rejectedTexts = 0;
  }
}
