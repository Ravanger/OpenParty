import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import MatchupVote from "../../ui/screens/MatchupVote.svelte";
import { addMine, answer, connectedClient, matchup } from "../helpers/client.js";

describe("Matchup vote screen", () => {
  function voting(mine: { canVote: boolean; isOwnMatchup: boolean; matchupVote?: string }) {
    const c = connectedClient({}, "MatchupVoting");
    c.state.matchups.push(
      matchup("m1", "Name a fruit", [answer("a1", "Mango"), answer("a2", "Kiwi")]),
    );
    c.state.activeMatchupIndex = 0;
    c.state.votesCast = 1;
    c.state.votesExpected = 3;
    addMine(c.state, c.manager.playerId, mine);
    return c;
  }

  it("shows only the answers and the turnout, and my own vote", () => {
    render(MatchupVote, {
      manager: voting({ canVote: true, isOwnMatchup: false, matchupVote: "a2" }).manager,
    });
    expect(screen.getByRole("heading", { name: "Name a fruit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kiwi" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mango" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("1 of 3 voted")).toBeInTheDocument();
    expect(screen.getByText("Matchup 1 of 1")).toBeInTheDocument();
    expect(screen.queryByText(/by /)).not.toBeInTheDocument();
  });

  it("slaps VOTED! on my pick and says how to switch", () => {
    render(MatchupVote, {
      manager: voting({ canVote: true, isOwnMatchup: false, matchupVote: "a2" }).manager,
    });
    expect(screen.getByText("VOTED!")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/tap the other one to switch/i);
  });

  it("asks for a vote until one is cast, and sends a TV to the phones", () => {
    const open = render(MatchupVote, {
      manager: voting({ canVote: true, isOwnMatchup: false }).manager,
    });
    expect(screen.getByText("Tap the funnier answer")).toBeInTheDocument();
    expect(screen.queryByText("VOTED!")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    open.unmount();
    const tv = voting({ canVote: false, isOwnMatchup: false });
    tv.state.players.delete(tv.manager.playerId);
    render(MatchupVote, { manager: tv.manager });
    expect(screen.getByText("Cast your votes on your phones.")).toBeInTheDocument();
  });

  it("casts a vote", async () => {
    const c = voting({ canVote: true, isOwnMatchup: false });
    render(MatchupVote, { manager: c.manager });
    await fireEvent.click(screen.getByRole("button", { name: "Mango" }));
    expect(c.room.requests).toEqual([
      { type: "ACTION", payload: { answerId: "a1", type: "CAST_VOTE" } },
    ]);
  });

  it("tells an author to sit tight and blocks the buttons", () => {
    render(MatchupVote, { manager: voting({ canVote: false, isOwnMatchup: true }).manager });
    expect(screen.getByText(/this one is yours/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mango" })).toBeDisabled();
  });

  it("explains a non-voter who is not an author", () => {
    render(MatchupVote, { manager: voting({ canVote: false, isOwnMatchup: false }).manager });
    expect(screen.getByText(/cannot vote on this one/i)).toBeInTheDocument();
  });

  it("says so when a matchup has a single answer and nobody votes", () => {
    const c = voting({ canVote: false, isOwnMatchup: false });
    const [forfeit] = c.state.matchups;
    if (forfeit) forfeit.isForfeit = true;
    render(MatchupVote, { manager: c.manager });
    expect(screen.getByText("Only one answer came in — no vote needed.")).toBeInTheDocument();
    expect(screen.queryByText(/cannot vote on this one/i)).not.toBeInTheDocument();
  });

  it("waits when there is no matchup", () => {
    render(MatchupVote, { manager: connectedClient({}, "MatchupVoting").manager });
    expect(screen.getByText("Waiting for matchup...")).toBeInTheDocument();
  });
});
