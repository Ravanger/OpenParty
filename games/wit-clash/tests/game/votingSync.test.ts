import { describe, expect, it } from "vitest";
import { PlayerPrivate } from "../../src/state.js";
import { VotingSync } from "../../src/votingSync.js";
import { makeCtx, seat } from "./ctxFixture.js";

describe("VotingSync (unit)", () => {
  it("publishes canVote, the per-player flags and the ballot count", () => {
    const { ctx } = makeCtx([seat("p1"), seat("p2"), seat("p3")]);
    ctx.priv.matchupVotes.set("p1", "a1");
    new VotingSync(ctx, {
      mayVote: (id) => id !== "p3",
      flags: (id, mine) => {
        mine.isOwnMatchup = id === "p2";
      },
    }).run();
    const mineOf = (id: string): PlayerPrivate => ctx.state.mine.get(id) as PlayerPrivate;
    expect(mineOf("p1").canVote).toBe(true);
    expect(mineOf("p2").canVote).toBe(true);
    expect(mineOf("p3").canVote).toBe(false);
    expect(mineOf("p2").isOwnMatchup).toBe(true);
    expect(mineOf("p1").isOwnMatchup).toBe(false);
    expect(ctx.state.votesExpected).toBe(2);
    expect(ctx.state.votesCast).toBe(1);
  });

  it("skips inactive seats without an entry and updates remembered ones in place", () => {
    const remembered = new PlayerPrivate();
    const { ctx } = makeCtx([
      seat("p1"),
      seat("p2", { isConnected: false }),
      seat("p3", { isActive: false }),
    ]);
    ctx.state.mine.set("p3", remembered);
    new VotingSync(ctx, {
      mayVote: (id) => id === "p1",
      flags: () => {},
    }).run();
    expect(ctx.state.mine.has("p1")).toBe(true);
    expect(ctx.state.mine.get("p2")).toBeUndefined();
    expect(ctx.state.mine.get("p3")).toBe(remembered);
    expect((ctx.state.mine.get("p3") as PlayerPrivate).canVote).toBe(false);
    expect(ctx.state.votesExpected).toBe(1);
    expect(ctx.state.votesCast).toBe(0);
  });
});
