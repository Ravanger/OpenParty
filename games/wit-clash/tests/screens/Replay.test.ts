import { required } from "@openparty/core";
import { ReplayViewer } from "@openparty/game-ui/components";
import { ErrorCode } from "@openparty/shared";
import { syncedJsonOf } from "@openparty/shared/schema";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WitClashState } from "../../src/state.js";
import { PHASE_SCREENS } from "../../ui/screens/index.js";
import Results from "../../ui/screens/Results.svelte";
import BUNDLE_TEXT from "../fixtures/replay-bundle.json?raw";
import { makeCategories, nth, Table } from "../game/support.js";
import { answer, connectedClient, matchup, scoreRow } from "../helpers/client.js";

const BUNDLE = JSON.parse(BUNDLE_TEXT) as {
  snapshots: Array<{ phase: string; state: Record<string, unknown> }>;
};

/** Puts `text` in the file input and fires its change event. */
function openBundle(text: string): void {
  const input = screen.getByLabelText("Open replay bundle");
  Object.defineProperty(input, "files", {
    value: [new File([text], "bundle.json", { type: "application/json" })],
  });
  void fireEvent.change(input);
}

/** Drives a one-round game through its final tie-breaker and records the final state of each
 * tie phase, in the same shape the server's exporter writes. */
function tieBreakerBundleText(): string {
  const t = new Table({
    players: 4,
    categories: makeCategories(4, 8, 3),
    options: { totalRounds: 1 },
  });
  const snapshots: Array<{ seq: number; phase: string; state: Record<string, unknown> }> = [];
  let seq = 0;
  const record = (): void => {
    if (t.phase.startsWith("TieBreaker")) {
      snapshots.push({ seq: ++seq, phase: t.phase, state: syncedJsonOf(t.state) });
    }
  };
  t.toVoting();
  for (;;) {
    if (t.phase === "MatchupVoting") {
      t.voteFor(nth(t.authors(), 0));
    } else if (t.phase === "MatchupReveal") {
      // Force a two-way tie for the lead when the last matchup is revealed.
      if (t.state.activeMatchupIndex + 1 === t.state.matchups.length) {
        t.priv.scores = { p1: 500, p2: 500, p3: 100, p4: 0 };
      }
      t.tick(5000);
    } else break;
  }
  record(); // TieBreakerPrompting: the tied players face the prompt
  for (const id of ["p1", "p2"]) {
    t.act(id, "SUBMIT_ANSWER", {
      matchupId: nth([...t.mine(id).prompts], 0).matchupId,
      answer: `${id} tie-breaker answer`,
    });
  }
  record(); // TieBreakerVoting: the answers are in, the votes are out
  const tie = required(t.state.tieBreakers[t.state.tieBreakers.length - 1], "tie-breaker");
  for (const voter of ["p3", "p4"]) {
    t.act(voter, "CAST_VOTE", { answerId: nth([...tie.answers], 0).id });
  }
  record(); // TieBreakerReveal: the verdict is in
  return JSON.stringify({ bundleVersion: 1, snapshots });
}

const renderViewer = () =>
  render(ReplayViewer, {
    screens: PHASE_SCREENS,
    stateClass: WitClashState,
    title: "WitClash replay",
  });

describe("Replay viewer", () => {
  it("renders the recorded lobby with the game's own screens", async () => {
    renderViewer();
    openBundle(BUNDLE_TEXT);
    // The first recorded phase is the lobby; its screen shows the seated players.
    expect(await screen.findByText("Bot 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByText(`1 / ${BUNDLE.snapshots.length}`)).toBeInTheDocument();
  });

  it("steps through the tie-breaker screens of a recorded game", async () => {
    renderViewer();
    openBundle(tieBreakerBundleText());
    expect(await screen.findByText("Sit tight while the tied players answer.")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Sit tight while the others vote.")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The reveal is the only tie phase that shows authors, so it proves the verdict rendered.
    expect(await screen.findByText("by p1")).toBeInTheDocument();
  });

  it("lets the lobby's leave button go quietly in replay mode", async () => {
    renderViewer();
    openBundle(BUNDLE_TEXT);
    await screen.findByText("Bot 1");
    await fireEvent.click(screen.getByRole("button", { name: "Leave game" }));
    expect(screen.getByText("Bot 1")).toBeInTheDocument();
  });
});

describe("replay export", () => {
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

  function results(role: "host" | "player", isFinalRound: boolean) {
    const c = connectedClient({ role }, "Results");
    c.state.isFinalRound = isFinalRound;
    c.state.roundNumber = isFinalRound ? 3 : 1;
    c.state.totalRounds = 3;
    c.state.scoreboard.push(
      scoreRow("ann", 500, { name: "Ann", roundPoints: 250, matchupsWon: 1, hadClash: true }),
      scoreRow("bob", 100, { name: "Bob", hasLeft: true }),
    );
    c.state.matchups.push(
      matchup(
        "m1",
        "Name a fruit",
        [answer("a1", "Mango", { authorName: "Ann", isWinner: true })],
        {
          isRevealed: true,
        },
      ),
    );
    return c;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestURL.createObjectURL.mockReset();
    TestURL.revokeObjectURL.mockReset();
  });

  it("lets the host download the bundle as JSON through the shared button", async () => {
    const c = results("host", true);
    c.room.reply = { bundleVersion: 1, name: "WitClash", snapshots: [] };
    const anchors = clickedAnchors();
    vi.stubGlobal("URL", TestURL);
    render(Results, { manager: c.manager });
    await fireEvent.click(screen.getByRole("button", { name: "Export replay" }));
    expect(c.room.requests).toEqual([{ type: "EXPORT_REPLAY", payload: undefined }]);
    expect(TestURL.createObjectURL).toHaveBeenCalledOnce();
    const blob = TestURL.createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(JSON.parse(await blob.text())).toMatchObject({ name: "WitClash" });
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.download).toBe("witclash-replay.json");
  });

  it("offers the export on the mid-round bar too", () => {
    const c = results("host", false);
    render(Results, { manager: c.manager });
    expect(screen.getByRole("button", { name: "Export replay" })).toBeInTheDocument();
  });

  it("remembers the server's refusal and downloads nothing", async () => {
    const c = results("host", true);
    c.room.reply = {
      ok: false,
      error: { code: ErrorCode.UNAUTHORIZED, message: "only the host can export" },
    };
    const anchors = clickedAnchors();
    vi.stubGlobal("URL", TestURL);
    render(Results, { manager: c.manager });
    await fireEvent.click(screen.getByRole("button", { name: "Export replay" }));
    expect(TestURL.createObjectURL).not.toHaveBeenCalled();
    expect(anchors).toHaveLength(0);
    expect(c.manager.lastServerError).toEqual({
      code: ErrorCode.UNAUTHORIZED,
      message: "only the host can export",
    });
  });

  it("hides the export from non-hosts", () => {
    render(Results, { manager: results("player", true).manager });
    expect(screen.queryByRole("button", { name: "Export replay" })).not.toBeInTheDocument();
  });
});
