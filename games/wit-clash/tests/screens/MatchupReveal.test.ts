import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import MatchupReveal from "../../ui/screens/MatchupReveal.svelte";
import { addMine, answer, connectedClient, matchup } from "../helpers/client.js";

describe("Matchup reveal screen", () => {
  it("shows authors, counts and the winner", () => {
    const c = connectedClient({}, "MatchupReveal");
    c.state.matchups.push(
      matchup(
        "m1",
        "Name a fruit",
        [
          answer("a1", "Mango", {
            votes: 2,
            authorId: c.manager.playerId,
            authorName: "Me",
            isWinner: true,
          }),
          answer("a2", "Kiwi", { votes: 1, authorId: "zed-12345", authorName: "Zed" }),
        ],
        { isRevealed: true, isClash: true },
      ),
    );
    c.state.activeMatchupIndex = 0;
    render(MatchupReveal, { manager: c.manager });
    expect(screen.getByText("by Me (you)")).toBeInTheDocument();
    expect(screen.getByText("by Zed")).toBeInTheDocument();
    expect(screen.getByText("1 vote")).toBeInTheDocument();
    expect(screen.getByText("2 votes")).toBeInTheDocument();
    expect(screen.getByText("CLASH!")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Winner" })).toBeInTheDocument();
    expect(screen.getByText(/next up in 0s/i)).toBeInTheDocument();
  });

  it("marks the answer I voted for", () => {
    const c = connectedClient({}, "MatchupReveal");
    c.state.matchups.push(
      matchup(
        "m1",
        "Name a fruit",
        [
          answer("a1", "Mango", { authorId: "zed-12345", authorName: "Zed", isWinner: true }),
          answer("a2", "Kiwi", { authorId: "amy-12345", authorName: "Amy" }),
        ],
        { isRevealed: true },
      ),
    );
    c.state.activeMatchupIndex = 0;
    addMine(c.state, c.manager.playerId, { matchupVote: "a2" });
    render(MatchupReveal, { manager: c.manager });
    expect(screen.getAllByText("MY PICK")).toHaveLength(1);
    expect(screen.queryByText("NO SHOW")).not.toBeInTheDocument();
    expect(screen.queryByText("CLASH!")).not.toBeInTheDocument();
  });

  it("shows a forfeit as one, without vote counts", () => {
    const c = connectedClient({}, "MatchupReveal");
    c.state.matchups.push(
      matchup(
        "m1",
        "Name a fruit",
        [
          answer("a1", "Mango", { authorId: "zed-12345", authorName: "Zed", isWinner: true }),
          answer("a2", "(no answer)", { authorId: "amy-12345", authorName: "Amy" }),
        ],
        { isRevealed: true, isForfeit: true },
      ),
    );
    c.state.activeMatchupIndex = 0;
    render(MatchupReveal, { manager: c.manager });
    expect(screen.getByText(/won by forfeit/i)).toBeInTheDocument();
    expect(screen.getByText("NO SHOW")).toBeInTheDocument();
    expect(screen.queryByText(/votes?$/)).not.toBeInTheDocument();
  });

  it("waits until the matchup is revealed", () => {
    render(MatchupReveal, { manager: connectedClient({}, "MatchupReveal").manager });
    expect(screen.getByRole("heading", { name: "Revealing..." })).toBeInTheDocument();
  });
});
