import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_MAX_LENGTH } from "../../src/actionNames.js";
import { PromptingViewModel } from "../../ui/viewmodels/PromptingViewModel.svelte.js";
import {
  addMine,
  type Client,
  connectedClient,
  prompt,
  type SeatConfig,
  withoutTyping,
} from "../helpers/client.js";

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

describe("PromptingViewModel", () => {
  function writing(seat: SeatConfig = {}) {
    const c = connectedClient(seat, "Prompting");
    const mine = addMine(c.state, c.manager.playerId);
    mine.prompts.push(prompt("m1", "First prompt"), prompt("m2", "Second prompt"));
    c.state.progress.set(c.manager.playerId, 0);
    c.state.progress.set("other-1234", 1);
    c.state.answersPerPlayer = 2;
    c.state.roundNumber = 1;
    c.state.totalRounds = 3;
    countdownTo(c, 90);
    return { c, mine, vm: new PromptingViewModel(c.manager) };
  }

  it("shows my prompts from my private entry", () => {
    const { vm } = writing();
    expect(vm.prompts.map((p) => p.promptText)).toEqual(["First prompt", "Second prompt"]);
    expect(vm.current?.matchupId).toBe("m1");
    expect(vm.roundLabel).toBe("Round 1 of 3");
    expect(vm.clock.secondsLeft).toBe(90);
    expect(vm.clock.totalSeconds).toBe(90);
    expect(vm.answersIn).toBe(1);
    expect(vm.answersExpected).toBe(4);
    vm.destroy();
  });

  it("keeps a draft per prompt and counts characters", () => {
    const { vm } = writing();
    vm.setDraft("hello");
    expect(vm.draft).toBe("hello");
    expect(vm.charsRemaining).toBe(195);
    expect(vm.canSubmit).toBe(true);
    vm.goTo(1);
    expect(vm.draft).toBe("");
    expect(vm.canSubmit).toBe(false);
    vm.setDraft("   ");
    expect(vm.canSubmit).toBe(false);
    vm.setDraft("x".repeat(201));
    expect(vm.canSubmit).toBe(false);
    vm.goTo(0);
    expect(vm.draft).toBe("hello");
    vm.destroy();
  });

  it("clamps navigation", () => {
    const { vm } = writing();
    vm.goTo(-3);
    expect(vm.currentIndex).toBe(0);
    vm.goTo(9);
    expect(vm.currentIndex).toBe(1);
    vm.destroy();
  });

  it("submits the trimmed answer and moves on to the next prompt", async () => {
    const { c, vm } = writing();
    vm.setDraft("  a witty line  ");
    await vm.submit();
    expect(withoutTyping(c)).toEqual([
      {
        type: "ACTION",
        payload: { matchupId: "m1", answer: "a witty line", type: "SUBMIT_ANSWER" },
      },
    ]);
    expect(vm.currentIndex).toBe(1);
    vm.setDraft("last one");
    await vm.submit();
    expect(vm.currentIndex).toBe(1);
    vm.destroy();
  });

  it("stays on the prompt when the server rejects the answer", async () => {
    const { c, vm } = writing();
    c.room.reply = { ok: false, error: { code: "WRONG_PHASE", message: "Too late" } };
    vm.setDraft("late");
    await vm.submit();
    expect(vm.currentIndex).toBe(0);
    expect(c.manager.lastServerError?.message).toBe("Too late");
    expect(vm.rejectionReason).toBe("");
    vm.destroy();
  });

  it("keeps the draft and shows the filter's reason after a rejected submit, then clears it", async () => {
    const { c, vm } = writing();
    expect(vm.rejectionReason).toBe("");
    c.room.reply = {
      ok: false,
      error: { code: "CONTENT_REJECTED", message: "contains inappropriate language" },
    };
    vm.setDraft("a rude line");
    await vm.submit();
    expect(vm.currentIndex).toBe(0);
    expect(vm.draft).toBe("a rude line");
    expect(vm.rejectionReason).toBe("contains inappropriate language");
    c.room.reply = { ok: true };
    vm.setDraft("a kind line");
    await vm.submit();
    expect(vm.currentIndex).toBe(1);
    expect(vm.rejectionReason).toBe("");
    expect(c.manager.lastServerError).toBeUndefined();
    vm.destroy();
  });

  it("gives the host a moderation line with the count and level", () => {
    const { c, vm } = writing({ role: "host" });
    expect(vm.moderationLine).toBe("0 answers rejected, level moderate");
    c.state.rejectedTexts = 1;
    c.patch();
    expect(vm.moderationLine).toBe("1 answer rejected, level moderate");
    c.state.rejectedTexts = 2;
    c.patch();
    expect(vm.moderationLine).toBe("2 answers rejected, level moderate");
    vm.destroy();
  });

  it("hides the moderation line from non-hosts and when filtering is off", () => {
    const { c, vm } = writing();
    c.state.rejectedTexts = 3;
    c.patch();
    expect(vm.moderationLine).toBe("");
    vm.destroy();

    const host = writing({ role: "host" });
    host.c.state.options = JSON.stringify({ totalRounds: 3, filterLevel: "off" });
    host.c.patch();
    expect(host.vm.moderationLine).toBe("");
    host.vm.destroy();
  });

  it("does not submit an empty draft or without prompts", async () => {
    const { c, vm } = writing();
    await vm.submit();
    c.state.mine.get(c.manager.playerId)?.prompts.clear();
    vm.setDraft("orphan");
    await vm.submit();
    expect(c.room.requests).toEqual([]);
    expect(vm.draft).toBe("");
    vm.destroy();
  });

  it("knows when everything was accepted, from the server", () => {
    const { c, mine, vm } = writing();
    expect(vm.allSubmitted).toBe(false);
    for (const p of mine.prompts) p.submitted = true;
    c.patch();
    expect(vm.allSubmitted).toBe(true);
    expect(vm.current?.submitted).toBe(true);
    vm.destroy();
  });

  it("shows the form until everything is in, and again while editing", async () => {
    const { c, mine, vm } = writing();
    expect(vm.showForm).toBe(true);
    for (const p of mine.prompts) p.submitted = true;
    c.patch();
    expect(vm.showForm).toBe(false);
    vm.goTo(1);
    vm.startEditing();
    expect(vm.showForm).toBe(true);
    expect(vm.currentIndex).toBe(0);
    vm.setDraft("Changed");
    await vm.submit();
    expect(vm.currentIndex).toBe(1);
    expect(vm.showForm).toBe(true);
    vm.setDraft("Again");
    await vm.submit();
    expect(vm.showForm).toBe(false);
    vm.destroy();
  });

  it("announces the countdown at 30, 10 and 5 seconds", () => {
    const { c, vm } = writing();
    expect(vm.clock.announcement).toBe("");
    countdownTo(c, 10);
    c.patch();
    expect(vm.clock.announcement).toBe("10 seconds remaining");
    vm.destroy();
  });

  it("copes with no prompts yet and no room", () => {
    const c = connectedClient({}, "Prompting");
    const vm = new PromptingViewModel(c.manager);
    expect(vm.prompts).toEqual([]);
    expect(vm.allSubmitted).toBe(false);
    expect(vm.isSittingOut).toBe(true);
    expect([vm.draft, vm.charsRemaining, vm.canSubmit]).toEqual(["", ANSWER_MAX_LENGTH, false]);
    expect(vm.categoryLabel).toBe("");
    c.manager.dispose();
    expect([vm.answersIn, vm.answersExpected, vm.roundLabel]).toEqual([0, 0, "Round 0 of 0"]);
    expect(vm.categoryLabel).toBe("");
    expect([vm.moderationLine, vm.rejectionReason]).toEqual(["", ""]);
    vm.destroy();
  });
});

function typingMessages(c: Client): boolean[] {
  return c.room.requests.flatMap((r) => {
    const payload = r.payload;
    if (typeof payload !== "object" || payload === null) return [];
    if (!("type" in payload) || payload.type !== "SET_TYPING") return [];
    return "typing" in payload ? [payload.typing === true] : [];
  });
}

describe("typing reports from the Prompting viewmodel", () => {
  function writing() {
    const c = connectedClient({}, "Prompting");
    addMine(c.state, c.manager.playerId).prompts.push(prompt("m1", "Q1"), prompt("m2", "Q2"));
    return { c, vm: new PromptingViewModel(c.manager) };
  }

  it("says true once on the first keystroke and false after 2.5 s of quiet", () => {
    const { c, vm } = writing();
    vm.setDraft("a");
    vm.setDraft("ab");
    vm.setDraft("abc");
    expect(typingMessages(c)).toEqual([true]);
    vi.advanceTimersByTime(2400);
    vm.setDraft("abcd");
    vi.advanceTimersByTime(2400);
    expect(typingMessages(c)).toEqual([true]);
    vi.advanceTimersByTime(100);
    expect(typingMessages(c)).toEqual([true, false]);
    vi.advanceTimersByTime(10_000);
    expect(typingMessages(c)).toEqual([true, false]);
    vm.setDraft("x");
    expect(typingMessages(c)).toEqual([true, false, true]);
    vm.destroy();
  });

  it("says false when the answer is submitted, and stays quiet when nothing was typed", async () => {
    const { c, vm } = writing();
    await vm.submit();
    expect(typingMessages(c)).toEqual([]);
    vm.setDraft("Mango");
    await vm.submit();
    expect(typingMessages(c)).toEqual([true, false]);
    vi.advanceTimersByTime(5000);
    expect(typingMessages(c)).toEqual([true, false]);
    vm.destroy();
  });

  it("says false when leaving the screen mid-sentence", () => {
    const { c, vm } = writing();
    vm.setDraft("x");
    vm.destroy();
    expect(typingMessages(c)).toEqual([true, false]);
  });

  it("reports nothing without a prompt to answer", () => {
    const c = connectedClient({}, "Prompting");
    const vm = new PromptingViewModel(c.manager);
    vm.setDraft("x");
    expect(typingMessages(c)).toEqual([]);
    vm.destroy();
  });

  it("exposes the progress of everyone", () => {
    const { c, vm } = writing();
    c.state.answersPerPlayer = 2;
    c.state.progress.set(c.manager.playerId, 1);
    expect(vm.progress.rows).toHaveLength(1);
    vm.destroy();
  });
});
