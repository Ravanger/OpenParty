import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { Award, BestAnswer, Highlight, HighlightAnswer } from "../../src/state.js";
import Results from "../../ui/screens/Results.svelte";
import { answer, connectedClient, matchup, scoreRow } from "../helpers/client.js";

describe("Results screen", () => {
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

  it("shows the round's recap and the scoreboard to a guest who waits for the host", () => {
    render(Results, { manager: results("player", false).manager });
    expect(screen.getByRole("heading", { name: "Round 1 of 3 Results" })).toBeInTheDocument();
    expect(screen.getByText("Name a fruit")).toBeInTheDocument();
    const rows = screen.getAllByText(/^#\d$/);
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Bob (left)")).toBeInTheDocument();
    expect(screen.getByText("+250")).toBeInTheDocument();
    expect(screen.getByText("CLASH")).toBeInTheDocument();
    expect(screen.getByText("Waiting for host to continue...")).toBeInTheDocument();
  });

  it("lets the host start the next round", async () => {
    const c = results("host", false);
    render(Results, { manager: c.manager });
    await fireEvent.click(screen.getByRole("button", { name: "Next Round" }));
    expect(c.room.requests).toEqual([{ type: "ACTION", payload: { type: "NEXT_ROUND" } }]);
  });

  it("announces the winner after the final round and lets the host play again", async () => {
    const c = results("host", true);
    render(Results, { manager: c.manager });
    expect(screen.getByRole("heading", { name: "Game Over!" })).toBeInTheDocument();
    expect(within(screen.getByText(/wins with/i)).getByText(/Ann/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Play Again" }));
    expect(c.room.requests).toEqual([{ type: "ACTION", payload: { type: "PLAY_AGAIN" } }]);
  });

  it("names joint winners, and waits for the host to restart", () => {
    const c = results("player", true);
    c.state.scoreboard.push(scoreRow("cy", 500, { name: "Cy" }));
    c.state.scoreboard.sort((a, b) => b.score - a.score);
    render(Results, { manager: c.manager });
    expect(screen.getByText(/Ann & Cy win with 500 points/)).toBeInTheDocument();
    expect(screen.getByText("Waiting for host to start a new game...")).toBeInTheDocument();
  });

  it("shows no banner when nobody has scored", () => {
    const c = connectedClient({}, "Results");
    c.state.isFinalRound = true;
    render(Results, { manager: c.manager });
    expect(screen.queryByText(/wins with/i)).not.toBeInTheDocument();
  });
});

describe("Results podium and awards", () => {
  function finale() {
    const c = connectedClient({ name: "Ann" }, "Results");
    c.state.isFinalRound = true;
    c.state.scoreboard.push(
      scoreRow(c.manager.playerId, 500, { name: "Ann", wonTieBreaker: true }),
      scoreRow("cy", 300, { name: "Cy" }),
      scoreRow("bob", 900, { name: "Bob", hasLeft: true }),
    );
    return c;
  }

  it("shows the top seated places, skips leavers and shows the tie-breaker winner", () => {
    render(Results, { manager: finale().manager });
    const podium = within(screen.getByLabelText("Podium"));
    expect(podium.getByText("1st")).toBeInTheDocument();
    expect(podium.getByText("2nd")).toBeInTheDocument();
    expect(podium.queryByText("3rd")).not.toBeInTheDocument();
    expect(podium.getByText("Ann")).toBeInTheDocument();
    expect(podium.getByText("Cy")).toBeInTheDocument();
    expect(podium.queryByText("Bob")).not.toBeInTheDocument();
    expect(podium.queryByText("left")).not.toBeInTheDocument();
    expect(podium.getByText("Won the tie-breaker")).toBeInTheDocument();
    expect(screen.getByText("TIE-BREAKER")).toBeInTheDocument();
    expect(screen.getByText("Bob (left)")).toBeInTheDocument();
  });

  it("hides the podium and the award when there is nothing to show", () => {
    render(Results, { manager: connectedClient({}, "Results").manager });
    expect(screen.queryByLabelText("Podium")).not.toBeInTheDocument();
    expect(screen.queryByText(/best answer/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Awards")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Highlights")).not.toBeInTheDocument();
  });

  it("shows the highlights with kind, prompt and answers, seatless", () => {
    const c = connectedClient({}, "Results");
    const h = Object.assign(new Highlight(), {
      kind: "biggestMargin",
      promptText: "What do you call a fake noodle?",
    });
    h.answers.push(
      Object.assign(new HighlightAnswer(), { authorName: "Ann", text: "A spaghetto.", votes: 3 }),
      Object.assign(new HighlightAnswer(), { authorName: "Bo", text: "Pasta fraud.", votes: 1 }),
    );
    c.state.highlights.push(h);
    render(Results, { manager: c.manager });
    const section = within(screen.getByLabelText("Highlights"));
    expect(section.getByText("Biggest margin")).toBeInTheDocument();
    expect(section.getByText("What do you call a fake noodle?")).toBeInTheDocument();
    expect(section.getByText("A spaghetto.")).toBeInTheDocument();
    expect(section.getByText("by Ann")).toBeInTheDocument();
  });

  it("gives tied players one step and the next tier the next step", () => {
    const c = connectedClient({ name: "Ann" }, "Results");
    c.state.scoreboard.push(
      scoreRow("a", 300, { name: "Ann" }),
      scoreRow("b", 300, { name: "Bea" }),
      scoreRow("c", 100, { name: "Cy" }),
    );
    render(Results, { manager: c.manager });
    const podium = within(screen.getByLabelText("Podium"));
    expect(podium.getAllByRole("listitem")).toHaveLength(2);
    expect(podium.getByText("1st")).toBeInTheDocument();
    expect(podium.getByText("2nd")).toBeInTheDocument();
    expect(podium.queryByText("3rd")).not.toBeInTheDocument();
  });

  it("rains confetti only once the game is over", () => {
    const final = render(Results, { manager: finale().manager });
    expect(final.container.querySelectorAll(".confetti i")).toHaveLength(40);
    expect(final.container.querySelector(".confetti")).toHaveAttribute("aria-hidden", "true");
    final.unmount();
    const round = render(Results, { manager: connectedClient({}, "Results").manager });
    expect(round.container.querySelector(".confetti")).not.toBeInTheDocument();
  });

  it("folds the recap after the scoreboard", () => {
    const c = finale();
    c.state.matchups.push(matchup("m1", "Name a fruit", [], { isRevealed: true }));
    render(Results, { manager: c.manager });
    const recap = screen.getByText("Matchup recap");
    expect(recap.closest("details")).not.toHaveAttribute("open");
    expect(within(screen.getByLabelText("Scoreboard")).getByText("Cy")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Scoreboard").compareDocumentPosition(recap) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  function award(text: string, authorId: string, authorName: string, votes: number) {
    return Object.assign(new BestAnswer(), {
      text,
      authorId,
      authorName,
      promptText: "Name a fruit",
      votes,
    });
  }

  it("shows the best answer with prompt, author and votes", () => {
    const c = finale();
    c.state.bestAnswers.push(award("Mango", c.manager.playerId, "Ann", 1));
    render(Results, { manager: c.manager });
    expect(screen.getByRole("heading", { name: "Best answer" })).toBeInTheDocument();
    expect(screen.getByText("Mango")).toBeInTheDocument();
    expect(screen.getByText("Name a fruit")).toBeInTheDocument();
    expect(screen.getByText("by Ann (you)")).toBeInTheDocument();
    expect(screen.getByText("1 vote")).toBeInTheDocument();
  });

  it("shows a shared best answer", () => {
    const c = finale();
    c.state.bestAnswers.push(
      award("Mango", c.manager.playerId, "Ann", 3),
      award("Kiwi", "bob", "Bob", 3),
    );
    render(Results, { manager: c.manager });
    expect(screen.getByRole("heading", { name: "Shared best answer" })).toBeInTheDocument();
    expect(screen.getByText("by Bob")).toBeInTheDocument();
    expect(screen.getAllByText("3 votes")).toHaveLength(2);
  });

  function ceremony(id: string, title: string, winnerNames: string[], detail: string) {
    const made = Object.assign(new Award(), { id, title, detail });
    for (const name of winnerNames) made.winnerNames.push(name);
    return made;
  }

  it("lists each award with its winners and detail", () => {
    const c = finale();
    c.state.awards.push(
      ceremony("fastest-answer", "Fastest answer", ["Ann"], "1.2 s"),
      ceremony("most-votes-received", "Most votes received", ["Bob", "Cy"], "3 votes"),
    );
    render(Results, { manager: c.manager });
    const section = screen.getByLabelText("Awards");
    expect(within(section).getByText("Fastest answer")).toBeInTheDocument();
    expect(within(section).getByText("Ann")).toBeInTheDocument();
    expect(within(section).getByText("1.2 s")).toBeInTheDocument();
    expect(within(section).getByText("Bob & Cy")).toBeInTheDocument();
    expect(within(section).getByText("3 votes")).toBeInTheDocument();
  });
});
