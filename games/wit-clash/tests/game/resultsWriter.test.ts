import { describe, expect, it } from "vitest";
import type { AnswerRecord } from "../../src/bestAnswers.js";
import { ResultsWriter } from "../../src/resultsWriter.js";
import { BestAnswer, type Highlight } from "../../src/state.js";
import { makeCtx, seat } from "./ctxFixture.js";

const record = (
  text: string,
  authorId: string,
  matchupId: string,
  votes = 0,
  answerMs?: number,
): AnswerRecord => ({
  text,
  authorId,
  authorName: `Name ${authorId}`,
  promptText: "Prompt",
  votes,
  matchupVotes: 4,
  matchupId,
  ...(answerMs !== undefined ? { answerMs } : {}),
});

describe("ResultsWriter (unit)", () => {
  it("writes the best answers and clears any earlier ones", () => {
    const { ctx } = makeCtx([]);
    ctx.state.bestAnswers.push(Object.assign(new BestAnswer(), { text: "stale" }));
    ctx.priv.answerHistory.push(
      record("a", "p1", "m1", 3),
      record("b", "p2", "m1", 1),
      record("c", "p3", "m1", 0),
    );
    new ResultsWriter(ctx).writeBestAnswers();
    expect([...ctx.state.bestAnswers].map((a) => a.text)).toEqual(["a"]);
  });

  it("leaves best answers empty when nothing was voted for", () => {
    const { ctx } = makeCtx([]);
    ctx.priv.answerHistory.push(record("c", "p3", "m1", 0));
    new ResultsWriter(ctx).writeBestAnswers();
    expect([...ctx.state.bestAnswers]).toHaveLength(0);
  });

  it("writes one card per highlight kind the history supports", () => {
    const { ctx } = makeCtx([]);
    ctx.priv.answerHistory.push(
      record("a1", "p1", "m1", 3, 100),
      record("a2", "p2", "m1", 1, 400),
      record("b1", "p3", "m2", 2, 50),
      record("b2", "p4", "m2", 1, 600),
    );
    new ResultsWriter(ctx).writeHighlights();
    const cards = [...ctx.state.highlights];
    expect(cards.map((c) => c.kind)).toEqual(["biggestMargin", "closestMatch", "fastestAnswer"]);
    expect((cards[0] as Highlight).answers.map((a) => a.text)).toEqual(["a1", "a2"]);
    expect((cards[2] as Highlight).answers.map((a) => a.text)).toEqual(["b1"]);
  });

  it("skips the highlight kinds the history cannot support", () => {
    const { ctx } = makeCtx([]);
    ctx.priv.answerHistory.push(record("solo", "p1", "m1", 2, 100));
    new ResultsWriter(ctx).writeHighlights();
    expect([...ctx.state.highlights].map((c) => c.kind)).toEqual(["fastestAnswer"]);
  });

  it("writes the scoreboard rows from scores, awards and the tie-breaker", () => {
    const { ctx } = makeCtx([seat("p1"), seat("p2")]);
    ctx.priv.scores = { p1: 500, p2: 300 };
    ctx.priv.roundAwards.push({
      playerId: "p1",
      votePoints: 450,
      bonusPoints: 50,
      total: 500,
      isWinner: true,
      isClash: false,
    });
    ctx.priv.tieBreakerWinnerId = "p2";
    new ResultsWriter(ctx).writeScoreboard();
    const rows = [...ctx.state.scoreboard];
    expect(rows.map((r) => r.playerId)).toEqual(["p1", "p2"]);
    expect(rows[0]?.name).toBe("Name p1");
    expect(rows[0]?.score).toBe(500);
    expect(rows[0]?.roundPoints).toBe(500);
    expect(rows[0]?.matchupsWon).toBe(1);
    expect(rows[1]?.wonTieBreaker).toBe(true);
    expect(rows[1]?.hasLeft).toBe(false);
  });
});
