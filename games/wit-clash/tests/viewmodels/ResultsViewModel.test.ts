import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Award, BestAnswer, Highlight, HighlightAnswer } from "../../src/state.js";
import { ResultsViewModel } from "../../ui/viewmodels/ResultsViewModel.js";
import { answer, type Client, connectedClient, matchup, scoreRow } from "../helpers/client.js";

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

describe("ResultsViewModel", () => {
  function results(role: "host" | "player", isFinalRound: boolean) {
    const c = connectedClient({ role }, "Results");
    c.state.isFinalRound = isFinalRound;
    c.state.roundNumber = isFinalRound ? 3 : 1;
    c.state.totalRounds = 3;
    c.state.scoreboard.push(
      scoreRow("ann", 500, { name: "Ann" }),
      scoreRow("bob", 500, { name: "Bob" }),
      scoreRow("cy", 100),
    );
    return { c, vm: new ResultsViewModel(c.manager) };
  }

  it("crowns every top-ranked player after the final round", () => {
    const { vm } = results("player", true);
    expect(vm.champions.map((r) => r.name)).toEqual(["Ann", "Bob"]);
    expect(vm.roundLabel).toBe("Round 3 of 3");
  });

  it("never crowns a player who left, even on the top score", () => {
    const c = connectedClient({}, "Results");
    c.state.isFinalRound = true;
    c.state.scoreboard.push(
      scoreRow("ann", 100, { name: "Ann" }),
      scoreRow("gus", 900, { name: "Gus", hasLeft: true }),
    );
    expect(new ResultsViewModel(c.manager).champions.map((r) => r.name)).toEqual(["Ann"]);
  });

  it("has no champion mid-game", () => {
    expect(results("player", false).vm.champions).toEqual([]);
  });

  it("offers the host the next step and nobody else", async () => {
    const midGame = results("host", false);
    expect([midGame.vm.showNextRound, midGame.vm.showPlayAgain]).toEqual([true, false]);
    await midGame.vm.nextRound();
    const final = results("host", true);
    expect([final.vm.showNextRound, final.vm.showPlayAgain]).toEqual([false, true]);
    await final.vm.playAgain();
    const guest = results("player", true);
    expect([guest.vm.isHost, guest.vm.showNextRound, guest.vm.showPlayAgain]).toEqual([
      false,
      false,
      false,
    ]);
    expect(midGame.c.room.requests).toEqual([{ type: "ACTION", payload: { type: "NEXT_ROUND" } }]);
    expect(final.c.room.requests).toEqual([{ type: "ACTION", payload: { type: "PLAY_AGAIN" } }]);
  });

  it("defaults without a room", () => {
    const { c, vm } = results("host", true);
    c.manager.dispose();
    expect([vm.isFinalRound, vm.roundLabel, vm.champions, vm.matchups]).toEqual([
      false,
      "Round 0 of 0",
      [],
      [],
    ]);
  });

  it("lists only revealed matchups in the results", () => {
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
    const results = new ResultsViewModel(c.manager);
    expect(results.matchups.map((m) => m.promptText)).toEqual(["Name a fruit"]);
  });

  describe("exportReplay", () => {
    class TestURL extends URL {
      static createObjectURL = vi.fn((_blob: unknown) => "blob:test");
      static revokeObjectURL = vi.fn((_url: string) => {});
    }

    function clickedAnchors(): HTMLAnchorElement[] {
      const anchors: HTMLAnchorElement[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        anchors.push(this);
      });
      return anchors;
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      TestURL.createObjectURL.mockReset();
      TestURL.revokeObjectURL.mockReset();
    });

    it("sends the host-only request and downloads the answer as JSON", async () => {
      const anchors = clickedAnchors();
      vi.stubGlobal("URL", TestURL);
      const { c, vm } = results("host", true);
      c.room.reply = { bundleVersion: 1, name: "WitClash", snapshots: [] };
      await vm.exportReplay();
      expect(c.room.requests).toEqual([{ type: "EXPORT_REPLAY", payload: undefined }]);
      expect(TestURL.createObjectURL).toHaveBeenCalledOnce();
      const blob = TestURL.createObjectURL.mock.calls[0]?.[0] as Blob;
      expect(JSON.parse(await blob.text())).toMatchObject({ name: "WitClash" });
      expect(anchors).toHaveLength(1);
      expect(anchors[0]?.download).toBe("witclash-replay.json");
    });

    it("sends nothing when the server refuses", async () => {
      const anchors = clickedAnchors();
      vi.stubGlobal("URL", TestURL);
      const { c, vm } = results("player", true);
      c.room.reply = { ok: false, error: { code: "UNAUTHORIZED", message: "no" } };
      await vm.exportReplay();
      expect(TestURL.createObjectURL).not.toHaveBeenCalled();
      expect(anchors).toHaveLength(0);
    });
  });
});

describe("ResultsViewModel copy", () => {
  it("words the champion line and the wait by the end of the game", () => {
    const c = connectedClient({}, "Results");
    const vm = new ResultsViewModel(c.manager);
    expect(vm.championLine).toBe("");
    expect(vm.waitingText).toBe("Waiting for host to continue...");
    c.state.isFinalRound = true;
    c.state.scoreboard.push(scoreRow("a", 5, { name: "Ann" }), scoreRow("b", 5, { name: "Bo" }));
    expect(vm.championLine).toBe("Ann & Bo win with 5 points!");
    expect(vm.waitingText).toBe("Waiting for host to start a new game...");
  });
});

describe("ResultsViewModel awards", () => {
  function best(text: string, authorId: string, votes: number) {
    return Object.assign(new BestAnswer(), {
      text,
      authorId,
      authorName: authorId,
      promptText: "Q",
      votes,
    });
  }

  it("lists a single best answer and flags my own", () => {
    const c = connectedClient({}, "Results");
    c.state.bestAnswers.push(best("Mango", c.manager.playerId, 3));
    const vm = new ResultsViewModel(c.manager);
    expect(vm.bestAnswerTitle).toBe("Best answer");
    expect(vm.bestAnswers).toEqual([
      { text: "Mango", promptText: "Q", authorName: c.manager.playerId, votes: 3, isMine: true },
    ]);
  });

  it("calls several a shared award", () => {
    const c = connectedClient({}, "Results");
    c.state.bestAnswers.push(best("A", "x", 3), best("B", "y", 3));
    expect(new ResultsViewModel(c.manager).bestAnswerTitle).toBe("Shared best answer");
  });

  it("exposes the podium, the ceremony and copes with no state", () => {
    const c = connectedClient({}, "Results");
    const vm = new ResultsViewModel(c.manager);
    c.state.scoreboard.push(scoreRow("a", 1, { wonTieBreaker: true }));
    expect(vm.podiumSteps[0]?.players[0]?.wonTieBreaker).toBe(true);
    const award = Object.assign(new Award(), {
      id: "fastest-answer",
      title: "Fastest answer",
      detail: "1.2 s",
    });
    award.winnerNames.push("Ann");
    c.state.awards.push(award);
    expect(vm.awards).toEqual([
      { id: "fastest-answer", title: "Fastest answer", winnerNames: ["Ann"], detail: "1.2 s" },
    ]);
    c.manager.dispose();
    expect(vm.bestAnswers).toEqual([]);
    expect(vm.awards).toEqual([]);
    expect(vm.highlights).toEqual([]);
    expect(vm.podiumSteps).toEqual([]);
  });
});

describe("ResultsViewModel highlights", () => {
  const highlight = (kind: string, authorName: string, text: string, votes: number): Highlight => {
    const h = Object.assign(new Highlight(), { kind, promptText: "Q" });
    h.answers.push(Object.assign(new HighlightAnswer(), { authorName, text, votes }));
    return h;
  };

  it("copies the highlights to plain views with a label per kind", () => {
    const c = connectedClient({}, "Results");
    c.state.highlights.push(
      highlight("biggestMargin", "Ann", "A blowout.", 3),
      highlight("closestMatch", "Bo", "A nail-biter.", 1),
      highlight("fastestAnswer", "Cy", "Quick!", 2),
    );
    const vm = new ResultsViewModel(c.manager);
    expect(vm.highlights).toEqual([
      {
        kind: "biggestMargin",
        label: "Biggest margin",
        promptText: "Q",
        answers: [{ authorName: "Ann", text: "A blowout.", votes: 3 }],
      },
      {
        kind: "closestMatch",
        label: "Closest match",
        promptText: "Q",
        answers: [{ authorName: "Bo", text: "A nail-biter.", votes: 1 }],
      },
      {
        kind: "fastestAnswer",
        label: "Fastest answer",
        promptText: "Q",
        answers: [{ authorName: "Cy", text: "Quick!", votes: 2 }],
      },
    ]);
  });

  it("is empty without highlights and labels an unknown kind safely", () => {
    const c = connectedClient({}, "Results");
    expect(new ResultsViewModel(c.manager).highlights).toEqual([]);
    c.state.highlights.push(highlight("mystery", "Ann", "?", 1));
    expect(new ResultsViewModel(c.manager).highlights[0]?.label).toBe("Highlight");
  });
});
