import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import CategoryVote from "../../ui/screens/CategoryVote.svelte";
import { addMine, connectedClient, option } from "../helpers/client.js";

describe("Category vote screen", () => {
  function categories() {
    const c = connectedClient({}, "CategorySelection");
    c.state.categoryOptions.push(option("a", 1), option("b", 0));
    c.state.roundNumber = 2;
    c.state.totalRounds = 3;
    c.state.votesCast = 1;
    c.state.votesExpected = 4;
    addMine(c.state, c.manager.playerId, { categoryVote: "a" });
    return c;
  }

  it("shows the round, the options with tallies, my choice and the turnout", () => {
    render(CategoryVote, { manager: categories().manager });
    expect(screen.getByText("Round 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /name a/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /name b/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("1 vote")).toBeInTheDocument();
    expect(screen.getByText("0 votes")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 voted")).toBeInTheDocument();
  });

  it("marks my pick with a sticker and shows the votes as pips", () => {
    const { container } = render(CategoryVote, { manager: categories().manager });
    expect(screen.getAllByText("MY PICK")).toHaveLength(1);
    expect(container.querySelectorAll(".pips i")).toHaveLength(1);
  });

  it("burns a sparkler for the voting time", () => {
    const { container } = render(CategoryVote, { manager: categories().manager });
    expect(container.querySelector(".sparkler")).toBeInTheDocument();
  });

  it("votes when a card is clicked", async () => {
    const c = categories();
    render(CategoryVote, { manager: c.manager });
    await fireEvent.click(screen.getByRole("button", { name: /name b/i }));
    expect(c.room.requests).toEqual([
      { type: "ACTION", payload: { categoryId: "b", type: "VOTE_CATEGORY" } },
    ]);
  });
});
