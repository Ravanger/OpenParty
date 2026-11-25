import { BaseGameState } from "@openparty/shared/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackBus } from "../src/FeedbackBus.js";
import type { RoomLike } from "../src/RoomLike.js";
import { StateFeedback } from "../src/StateFeedback.js";
import { StubRoom } from "../src/testing.js";

const cleanups: Array<() => void> = [];

function setup() {
  const bus = new FeedbackBus(() => false);
  const state = new BaseGameState();
  state.roomCode = "ABCD";
  const room = new StubRoom(state);
  const holder: { room?: RoomLike<BaseGameState> } = {};
  const feedback = new StateFeedback(bus, () => holder.room);
  cleanups.push(() => feedback.dispose());
  return { bus, state, room, holder, feedback };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

describe("StateFeedback", () => {
  it("treats the first observed phase as the silent baseline and emits on a change", () => {
    const { bus, state, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("phase", (event) => seen.push(event)); // no room yet: sync is a no-op
    holder.room = room;
    feedback.sync(); // as the manager's attach does
    room.patch(); // the first observation after connecting is the silent baseline
    expect(seen).toHaveLength(0);
    state.phase = "Playing";
    room.patch();
    expect(seen).toEqual([{ type: "phase", from: "Lobby", to: "Playing", reducedMotion: false }]);
    state.phase = "Playing";
    room.patch(); // an unchanged phase emits nothing
    expect(seen).toHaveLength(1);
  });

  it("fires urgent once per phase in the last ten seconds and re-arms on a phase change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { bus, state, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("urgent", (event) => seen.push(event));
    holder.room = room;
    feedback.sync();

    state.serverNow = 1_000_000;
    state.phaseEndsAt = 1_060_000; // a minute left: not urgent yet
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(0);

    state.phaseEndsAt = 1_004_750; // inside the ten-second window
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toEqual([{ type: "urgent", reducedMotion: false }]);
    await vi.advanceTimersByTimeAsync(1_000); // still urgent: no repeat
    expect(seen).toHaveLength(1);

    state.phase = "Playing"; // a new phase may become urgent again
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(2);
  });

  it("stays silent until the first server time anchors the clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { bus, state, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("urgent", (event) => seen.push(event));
    holder.room = room;
    feedback.sync();
    state.phaseEndsAt = 1_004_750; // inside the window, but no server time to anchor against
    room.patch();
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toHaveLength(0);
    state.serverNow = 1_000_000;
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toEqual([{ type: "urgent", reducedMotion: false }]);
  });

  it("does not fire urgent for an expired countdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { bus, state, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("urgent", (event) => seen.push(event));
    holder.room = room;
    feedback.sync();
    state.serverNow = 1_000_000;
    state.phaseEndsAt = 900_000; // already in the past
    room.patch();
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toHaveLength(0);
  });

  it("runs no watcher or timer while nothing listens for phase or urgent", async () => {
    vi.useFakeTimers();
    const { bus, state, room, holder, feedback } = setup();
    holder.room = room;
    feedback.sync(); // nobody listens yet: nothing starts
    expect(vi.getTimerCount()).toBe(0);

    state.phase = "Playing";
    room.patch(); // unlistened: nothing is observed, no baseline is established

    const seen: unknown[] = [];
    const offPhase = bus.on("phase", (event) => seen.push(event));
    const offUrgent = bus.on("urgent", () => undefined); // the second subscription sees the running watcher
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the first subscriber starts the watchers

    state.phase = "Results";
    room.patch();
    await vi.advanceTimersByTimeAsync(500); // ticks run with no server time: the urgency check stays silent
    // a late subscriber sees only transitions it actually observed, starting from its own baseline
    expect(seen).toEqual([{ type: "phase", from: "Playing", to: "Results", reducedMotion: false }]);

    offPhase();
    offUrgent();
    expect(vi.getTimerCount()).toBe(0); // the last unsubscribe stops them again
  });

  it("re-establishes the phase baseline silently after a stop and re-sync", () => {
    const { bus, state, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("phase", (event) => seen.push(event));
    holder.room = room;
    feedback.sync();
    room.patch(); // the first observation after connecting is the silent baseline
    state.phase = "Playing";
    room.patch();
    expect(seen).toEqual([{ type: "phase", from: "Lobby", to: "Playing", reducedMotion: false }]);

    const secondState = new BaseGameState();
    secondState.roomCode = "EFGH";
    secondState.phase = "Results";
    const room2 = new StubRoom(secondState);
    feedback.stop(); // as the manager's detach does on a reconnect
    holder.room = room2;
    feedback.sync(); // as the manager's attach does
    room2.patch();
    expect(seen).toHaveLength(1); // the first observation of the new room emits no from/to event
  });

  it("stops and leaves the bus change feed on dispose", () => {
    vi.useFakeTimers();
    const { bus, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("phase", (event) => seen.push(event));
    holder.room = room;
    feedback.sync();
    room.patch(); // baseline
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    feedback.dispose();
    expect(vi.getTimerCount()).toBe(0);

    const off = bus.on("urgent", () => undefined); // a later subscription must not restart the watchers
    expect(vi.getTimerCount()).toBe(0);
    off();
    expect(seen).toHaveLength(0);
  });

  it("does not fire urgent while paused, even when wall time crosses the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { bus, state, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("urgent", (event) => seen.push(event));
    holder.room = room;
    feedback.sync();

    state.serverNow = 1_000_000;
    state.phaseEndsAt = 1_025_000; // twenty-five seconds left: outside the window
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(0);

    state.pausedAt = 1_000_000; // the host pauses with time to spare
    room.patch();
    state.serverNow = 1_016_000; // wall time crosses the ten-second window while paused
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(0);

    // resume: the host shifts the deadline by the paused time, so no urgency either
    state.pausedAt = 0;
    state.phaseEndsAt = 1_041_000;
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(0);
  });

  it("fires urgent after a resume once the shifted deadline enters the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { bus, state, room, holder, feedback } = setup();
    const seen: unknown[] = [];
    bus.on("urgent", (event) => seen.push(event));
    holder.room = room;
    feedback.sync();

    state.serverNow = 1_000_000;
    state.phaseEndsAt = 1_025_000;
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(0);

    state.pausedAt = 1_000_000;
    room.patch();
    state.serverNow = 1_016_000;
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(0);

    state.pausedAt = 0;
    state.phaseEndsAt = 1_041_000; // twenty-five seconds of active time left again
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(0);

    state.serverNow = 1_036_000; // five seconds left after the resume
    room.patch();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toEqual([{ type: "urgent", reducedMotion: false }]);
  });
});
