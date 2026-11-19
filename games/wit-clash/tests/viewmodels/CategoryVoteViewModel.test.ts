import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryVoteViewModel } from "../../ui/viewmodels/CategoryVoteViewModel.js";
import { addMine, type Client, connectedClient, option } from "../helpers/client.js";

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

describe("CategoryVoteViewModel", () => {
  function voting() {
    const c = connectedClient({}, "CategorySelection");
    c.state.categoryOptions.push(option("a", 2), option("b", 1));
    c.state.roundNumber = 2;
    c.state.totalRounds = 3;
    c.state.votesCast = 3;
    c.state.votesExpected = 4;
    countdownTo(c, 30, 60);
    addMine(c.state, c.manager.playerId, { categoryVote: "b" });
    return { c, vm: new CategoryVoteViewModel(c.manager) };
  }

  it("shows the options with their public tallies and my own vote", () => {
    const { c, vm } = voting();
    expect(vm.options).toEqual([
      { id: "a", name: "Name a", emoji: "E", votes: 2 },
      { id: "b", name: "Name b", emoji: "E", votes: 1 },
    ]);
    expect(vm.myVote).toBe("b");
    expect(vm.votesCast).toBe(3);
    expect(vm.votesExpected).toBe(4);
    expect(vm.roundLabel).toBe("Round 2 of 3");
    expect(c.manager.me()).toBeDefined();
  });

  it("counts down and announces only at 30, 10 and 5 seconds", () => {
    const { c, vm } = voting();
    expect(vm.clock.secondsLeft).toBe(30);
    expect(vm.clock.totalSeconds).toBe(60);
    expect(vm.clock.announcement).toBe("30 seconds remaining");
    c.state.phaseEndsAt = 1_000_000 + 7000;
    c.patch();
    expect(vm.clock.announcement).toBe("");
  });

  it("votes through the action protocol", async () => {
    const { c, vm } = voting();
    await vm.vote("a");
    expect(c.room.requests).toEqual([
      { type: "ACTION", payload: { categoryId: "a", type: "VOTE_CATEGORY" } },
    ]);
  });

  it("is empty without a room", () => {
    const { c, vm } = voting();
    c.manager.dispose();
    expect([vm.options, vm.myVote, vm.votesCast, vm.votesExpected, vm.roundLabel]).toEqual([
      [],
      "",
      0,
      0,
      "Round 0 of 0",
    ]);
  });
});
