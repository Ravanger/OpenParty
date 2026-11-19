import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchupVoteViewModel } from "../../ui/viewmodels/MatchupVoteViewModel.js";
import { addMine, answer, type Client, connectedClient, matchup } from "../helpers/client.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

const countdownTo = (c: Client, seconds: number, totalSeconds = seconds) => {
  c.state.serverNow = 1_000_000;
  c.state.phaseEndsAt = 1_000_000 + seconds * 1000;
  c.state.phaseDurationMs = totalSeconds * 1000;
};

describe("MatchupVoteViewModel", () => {
  function voting(mine: { canVote: boolean; isOwnMatchup: boolean; matchupVote?: string }) {
    const c = connectedClient({}, "MatchupVoting");
    c.state.matchups.push(
      matchup("m1", "Done", [answer("x", "old")], { isRevealed: true }),
      matchup("m2", "Name a fruit", [answer("a1", "Mango"), answer("a2", "Kiwi")]),
    );
    c.state.activeMatchupIndex = 1;
    c.state.votesCast = 1;
    c.state.votesExpected = 3;
    countdownTo(c, 20);
    addMine(c.state, c.manager.playerId, mine);
    return { c, vm: new MatchupVoteViewModel(c.manager) };
  }

  it("shows the prompt and answers with no authors or counts", () => {
    const { vm } = voting({ canVote: true, isOwnMatchup: false });
    expect(vm.promptText).toBe("Name a fruit");
    expect(vm.matchupNumber).toBe(2);
    expect(vm.totalMatchups).toBe(2);
    expect(vm.choices).toEqual([
      { id: "a1", text: "Mango", picked: false },
      { id: "a2", text: "Kiwi", picked: false },
    ]);
    expect(vm.votesCast).toBe(1);
    expect(vm.votesExpected).toBe(3);
    expect(vm.clock.secondsLeft).toBe(20);
    expect(vm.clock.totalSeconds).toBe(20);
    expect(vm.clock.announcement).toBe("");
  });

  it("highlights only my own vote", () => {
    const { vm } = voting({ canVote: true, isOwnMatchup: false, matchupVote: "a2" });
    expect(vm.choices.map((c) => c.picked)).toEqual([false, true]);
  });

  it("casts a vote when allowed", async () => {
    const { c, vm } = voting({ canVote: true, isOwnMatchup: false });
    await vm.vote("a1");
    expect(c.room.requests).toEqual([
      { type: "ACTION", payload: { answerId: "a1", type: "CAST_VOTE" } },
    ]);
  });

  it("does not offer a vote to the author of the matchup", async () => {
    const { c, vm } = voting({ canVote: false, isOwnMatchup: true });
    expect(vm.isOwnMatchup).toBe(true);
    expect(vm.canVote).toBe(false);
    await vm.vote("a1");
    expect(c.room.requests).toEqual([]);
  });

  it("does not offer a vote on a forfeit", () => {
    const { c, vm } = voting({ canVote: true, isOwnMatchup: false });
    const active = c.state.matchups[1];
    if (active) active.isForfeit = true;
    expect(vm.isForfeit).toBe(true);
    expect(vm.canVote).toBe(false);
  });

  it("is empty before a matchup and without my private entry", () => {
    const c = connectedClient({}, "MatchupVoting");
    const vm = new MatchupVoteViewModel(c.manager);
    expect([vm.promptText, vm.choices, vm.canVote, vm.isOwnMatchup, vm.isForfeit]).toEqual([
      "",
      [],
      false,
      false,
      false,
    ]);
    c.manager.dispose();
    expect([vm.matchupNumber, vm.totalMatchups, vm.votesCast, vm.votesExpected]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});
