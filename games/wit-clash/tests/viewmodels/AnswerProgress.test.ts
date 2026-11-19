import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerProgress } from "../../ui/viewmodels/AnswerProgress.js";
import { addSeat, connectedClient } from "../helpers/client.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AnswerProgress", () => {
  it("lists every answering player with progress, completion and typing", () => {
    const c = connectedClient({ name: "Me" }, "Prompting");
    addSeat(c.state, "zed-12345", { name: "Zed" });
    addSeat(c.state, "amy-12345", { name: "Amy" });
    c.state.answersPerPlayer = 2;
    c.state.progress.set(c.manager.playerId, 1);
    c.state.progress.set("zed-12345", 2);
    c.state.progress.set("amy-12345", 0);
    c.state.typing.set(c.manager.playerId, true);
    c.state.typing.set("zed-12345", true);
    const { rows } = new AnswerProgress(c.manager);
    expect(rows).toEqual([
      {
        playerId: c.manager.playerId,
        name: "Me",
        answered: 1,
        expected: 2,
        done: false,
        typing: true,
        isMe: true,
      },
      {
        playerId: "zed-12345",
        name: "Zed",
        answered: 2,
        expected: 2,
        done: true,
        typing: false,
        isMe: false,
      },
      {
        playerId: "amy-12345",
        name: "Amy",
        answered: 0,
        expected: 2,
        done: false,
        typing: false,
        isMe: false,
      },
    ]);
  });

  it("never calls anyone done before answers are expected, and copes with unknown players", () => {
    const c = connectedClient({}, "Prompting");
    c.state.progress.set("ghost", 0);
    const [row] = new AnswerProgress(c.manager).rows;
    expect(row).toMatchObject({ name: "", done: false });
  });

  it("is empty when disconnected", () => {
    const c = connectedClient({}, "Prompting");
    const progress = new AnswerProgress(c.manager);
    c.manager.dispose();
    expect(progress.rows).toEqual([]);
  });
});
