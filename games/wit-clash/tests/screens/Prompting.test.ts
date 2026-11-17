import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { ANSWER_MAX_LENGTH } from "../../src/actionNames.js";
import Prompting from "../../ui/screens/Prompting.svelte";
import {
  addMine,
  addSeat,
  connectedClient,
  option,
  prompt,
  withoutTyping,
} from "../helpers/client.js";

describe("Prompting screen", () => {
  function writing() {
    const c = connectedClient({}, "Prompting");
    const mine = addMine(c.state, c.manager.playerId);
    mine.prompts.push(prompt("m1", "First prompt"), prompt("m2", "Second prompt"));
    c.state.progress.set(c.manager.playerId, 0);
    c.state.answersPerPlayer = 2;
    c.state.roundNumber = 1;
    c.state.totalRounds = 3;
    return { c, mine };
  }

  it("tells a player who was dealt nothing that they vote this round, then shows prompts", () => {
    const empty = connectedClient({}, "Prompting");
    const { unmount } = render(Prompting, { manager: empty.manager });
    expect(
      screen.getByText("You're sitting this round out — you'll vote on the answers."),
    ).toBeInTheDocument();
    unmount();
    render(Prompting, { manager: writing().c.manager });
    expect(screen.getByRole("heading", { name: "First prompt" })).toBeInTheDocument();
    expect(screen.getByText("Round 1 of 3")).toBeInTheDocument();
  });

  it("names the category that won the vote", () => {
    const { c } = writing();
    c.state.categoryOptions.push(option("a"), option("b"));
    c.state.selectedCategory = "b";
    render(Prompting, { manager: c.manager });
    expect(screen.getByText("E Name b")).toBeInTheDocument();
  });

  it("caps the answer box at the shared answer limit", () => {
    render(Prompting, { manager: writing().c.manager });
    expect(screen.getByLabelText("Your answer")).toHaveAttribute(
      "maxlength",
      String(ANSWER_MAX_LENGTH),
    );
  });

  it("submits the typed answer and moves to the next prompt", async () => {
    const { c } = writing();
    render(Prompting, { manager: c.manager });
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    await fireEvent.input(screen.getByLabelText("Your answer"), { target: { value: "Mango" } });
    expect(screen.getByText("195 chars left")).toBeInTheDocument();
    await fireEvent.click(submit);
    await screen.findByRole("heading", { name: "Second prompt" });
    expect(withoutTyping(c)).toEqual([
      {
        type: "ACTION",
        payload: { matchupId: "m1", answer: "Mango", type: "SUBMIT_ANSWER" },
      },
    ]);
  });

  it("keeps the typed answer when the server rejects it, with the reason beside it", async () => {
    const { c } = writing();
    c.room.reply = {
      ok: false,
      error: { code: "CONTENT_REJECTED", message: "That text was not allowed" },
    };
    render(Prompting, { manager: c.manager });
    await fireEvent.input(screen.getByLabelText("Your answer"), {
      target: { value: "Keep me here" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await vi.waitFor(() => expect(c.manager.lastServerError?.code).toBe("CONTENT_REJECTED"));
    expect(screen.getByLabelText("Your answer")).toHaveValue("Keep me here");
    expect(screen.getByText("That text was not allowed")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Second prompt" })).not.toBeInTheDocument();
  });

  it("shows the host a moderation line with the count and level", () => {
    const c = connectedClient({ role: "host" }, "Prompting");
    c.state.rejectedTexts = 2;
    render(Prompting, { manager: c.manager });
    expect(screen.getByText("2 answers rejected, level moderate")).toBeInTheDocument();
  });

  it("shows no moderation line to a non-host", () => {
    const { c } = writing();
    c.state.rejectedTexts = 2;
    render(Prompting, { manager: c.manager });
    expect(screen.queryByText(/rejected, level/)).not.toBeInTheDocument();
  });

  it("submits on Enter and lets Shift+Enter through", async () => {
    const { c } = writing();
    render(Prompting, { manager: c.manager });
    const box = screen.getByLabelText("Your answer");
    await fireEvent.input(box, { target: { value: "Quick" } });
    await fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(withoutTyping(c)).toEqual([]);
    await fireEvent.keyDown(box, { key: "Enter" });
    expect(withoutTyping(c)).toHaveLength(1);
  });

  it("jumps between prompts and ticks the ones the server accepted", async () => {
    const { c, mine } = writing();
    const [first] = mine.prompts;
    if (first) first.submitted = true;
    render(Prompting, { manager: c.manager });
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    const tab = screen.getByRole("button", { name: "Prompt 1" });
    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(tab).toHaveTextContent("✓");
    await fireEvent.click(screen.getByRole("button", { name: "Prompt 2" }));
    expect(screen.getByRole("heading", { name: "Second prompt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("collapses into a done note once everything is in, and reopens to edit", async () => {
    const { c, mine } = writing();
    for (const p of mine.prompts) p.submitted = true;
    render(Prompting, { manager: c.manager });
    expect(screen.getByText(/all answers in/i)).toBeInTheDocument();
    expect(screen.getByText("Waiting for the others: 0 of 2 answers in")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Edit answers" }));
    expect(screen.getByLabelText("Your answer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("shows a TV the count and the strip, without any input", () => {
    const c = connectedClient({}, "Prompting");
    c.state.players.delete(c.manager.playerId);
    c.state.answersPerPlayer = 2;
    c.state.progress.set("zed-12345", 1);
    render(Prompting, { manager: c.manager });
    expect(screen.getByText("1 of 2 answers in")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
  });
});

describe("Answer progress and typing", () => {
  it("shows every player's progress, a done tick and who is typing while prompting", () => {
    const c = connectedClient({ name: "Me" }, "Prompting");
    addSeat(c.state, "zed-12345", { name: "Zed" });
    addSeat(c.state, "amy-12345", { name: "Amy" });
    addMine(c.state, c.manager.playerId).prompts.push(prompt("m1", "Q"));
    c.state.answersPerPlayer = 2;
    c.state.progress.set(c.manager.playerId, 1);
    c.state.progress.set("zed-12345", 2);
    c.state.progress.set("amy-12345", 0);
    c.state.typing.set("amy-12345", true);
    render(Prompting, { manager: c.manager });
    const list = within(screen.getByLabelText("Answer progress"));
    expect(list.getByText("1/2")).toBeInTheDocument();
    expect(list.getByText("2/2")).toBeInTheDocument();
    expect(list.getByRole("img", { name: "Done" })).toBeInTheDocument();
    expect(list.getAllByText("typing…")).toHaveLength(1);
  });

  it("shows it to a TV without a seat, and nothing before anyone is answering", () => {
    const c = connectedClient({}, "Prompting");
    const { unmount } = render(Prompting, { manager: c.manager });
    expect(screen.queryByLabelText("Answer progress")).not.toBeInTheDocument();
    unmount();
    c.state.progress.set("zed-12345", 0);
    c.state.answersPerPlayer = 2;
    c.state.players.delete(c.manager.playerId);
    render(Prompting, { manager: c.manager });
    expect(screen.getByLabelText("Answer progress")).toBeInTheDocument();
  });
});
