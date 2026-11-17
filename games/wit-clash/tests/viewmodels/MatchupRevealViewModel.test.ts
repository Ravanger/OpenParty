import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchupRevealViewModel } from "../../ui/viewmodels/MatchupRevealViewModel.js";
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

describe("MatchupRevealViewModel", () => {
  function revealed() {
    const c = connectedClient({}, "MatchupReveal");
    c.state.matchups.push(
      matchup(
        "m1",
        "Name a fruit",
        [
          answer("a1", "Mango", {
            votes: 3,
            authorId: c.manager.playerId,
            authorName: "Me",
            isWinner: true,
          }),
          answer("a2", "Kiwi", { votes: 0, authorId: "other-1234", authorName: "Zed" }),
        ],
        { isRevealed: true, isClash: true },
      ),
      matchup("m2", "Hidden", [answer("b1", "?")]),
    );
    c.state.activeMatchupIndex = 0;
    countdownTo(c, 5);
    return { c, vm: new MatchupRevealViewModel(c.manager) };
  }

  it("shows who wrote what, the counts and the winner as the server published them", () => {
    const { c, vm } = revealed();
    expect(vm.matchup).toEqual({
      promptText: "Name a fruit",
      isForfeit: false,
      isClash: true,
      answers: [
        {
          id: "a1",
          text: "Mango",
          votes: 3,
          authorId: c.manager.playerId,
          authorName: "Me",
          isWinner: true,
          isMine: true,
        },
        {
          id: "a2",
          text: "Kiwi",
          votes: 0,
          authorId: "other-1234",
          authorName: "Zed",
          isWinner: false,
          isMine: false,
        },
      ],
    });
    expect(vm.matchupNumber).toBe(1);
    expect(vm.totalMatchups).toBe(2);
    expect(vm.clock.secondsLeft).toBe(5);
    expect(vm.clock.totalSeconds).toBe(5);
  });

  it("remembers who I voted for", () => {
    const { c, vm } = revealed();
    expect(vm.myVoteId).toBe("");
    addMine(c.state, c.manager.playerId, { matchupVote: "a2" });
    expect(vm.myVoteId).toBe("a2");
    c.manager.dispose();
    expect(vm.myVoteId).toBe("");
  });

  it("shows nothing until the matchup is revealed or when there is none", () => {
    const { c, vm } = revealed();
    c.state.activeMatchupIndex = 1;
    expect(vm.matchup).toBeUndefined();
    c.state.activeMatchupIndex = -1;
    expect(vm.matchup).toBeUndefined();
    c.manager.dispose();
    expect([vm.matchup, vm.matchupNumber, vm.totalMatchups]).toEqual([undefined, 0, 0]);
  });
});
