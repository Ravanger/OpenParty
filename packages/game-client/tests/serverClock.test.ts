import { BaseGameState } from "@openparty/shared/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerClock } from "../src/serverClock.js";
import { StubRoom } from "../src/testing.js";

afterEach(() => vi.useRealTimers());

function stateOf(serverNow = 1_000_000): BaseGameState {
  const state = new BaseGameState();
  state.roomCode = "ABCD";
  state.serverNow = serverNow;
  return state;
}

describe("ServerClock", () => {
  it("falls back to local time before the first server sample", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234_567);
    const clock = new ServerClock();
    clock.detach(); // no room yet: nothing to stop
    expect(clock.now()).toBe(1_234_567);
  });

  it("samples the round-trip time on join and every 30 seconds while read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const room = new StubRoom(stateOf());
    room.pingRttMs = 80;
    const clock = new ServerClock();
    clock.attach(room);
    expect(room.pingCalls).toBe(1);
    clock.now(); // still inside the first 30 seconds
    expect(room.pingCalls).toBe(1);
    vi.advanceTimersByTime(30_000);
    clock.now();
    expect(room.pingCalls).toBe(2);
    clock.detach();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts half the round-trip time as the one-way delay of an observation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const state = stateOf(0);
    const room = new StubRoom(state);
    room.pingRttMs = 100;
    const clock = new ServerClock();
    clock.attach(room); // observes 0 server time: not a sample yet, then measures RTT
    state.serverNow = 1_000_000;
    room.patch();
    room.patch(); // the same reading is ignored
    expect(clock.now()).toBe(1_000_050);
    clock.detach();
  });

  it("converges when serverNow steps forward while the local clock lags", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const state = stateOf();
    const room = new StubRoom(state);
    const clock = new ServerClock();
    clock.attach(room);
    for (let i = 0; i < 4; ++i) {
      vi.advanceTimersByTime(1_010);
      state.serverNow += 1_000;
      room.patch();
    }
    expect(clock.now()).toBe(state.serverNow);
    clock.detach();
  });

  it("never moves backwards, even after a smaller server or local sample", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const state = stateOf();
    const room = new StubRoom(state);
    const clock = new ServerClock();
    clock.attach(room);
    expect(clock.now()).toBe(1_000_000);

    vi.advanceTimersByTime(1_000);
    state.serverNow = 900_000;
    room.patch();
    expect(clock.now()).toBe(1_000_000);

    vi.setSystemTime(800_000);
    expect(clock.now()).toBe(1_000_000);
    clock.detach();
  });

  it("re-learns the clock after reattaching to a new room", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const firstRoom = new StubRoom(stateOf(1_000_000));
    const clock = new ServerClock();
    clock.attach(firstRoom);
    expect(clock.isSynced).toBe(true);

    clock.detach();
    const secondRoom = new StubRoom(stateOf(5_000_000));
    clock.attach(secondRoom);
    expect(clock.now()).toBe(5_000_000);
    clock.detach();
  });
});
