import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tween } from "../src/tween.svelte.js";
import { observe } from "./support/observe.svelte.js";

afterEach(() => vi.useRealTimers());

/** A hand-driven clock for the tests: the tween reads it, the test moves it. */
function fakeClock(start: number) {
  let now = start;
  return {
    clock: { now: () => now },
    set: (value: number) => {
      now = value;
    },
  };
}

describe("Tween", () => {
  it("returns from before the start and the endpoint after the end", () => {
    const time = fakeClock(1_000);
    const tween = new Tween(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 20 }, startedAt: 2_000, durationMs: 1_000 },
      time.clock,
    );
    time.set(1_500);
    expect(tween.progress).toBe(0);
    expect(tween.position).toEqual({ x: 0, y: 0 });
    time.set(3_500);
    expect(tween.progress).toBe(1);
    expect(tween.position).toEqual({ x: 10, y: 20 });
  });

  it("interpolates linearly between two points", () => {
    const time = fakeClock(0);
    const tween = new Tween(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 20 }, startedAt: 0, durationMs: 1_000 },
      time.clock,
    );
    time.set(250);
    expect(tween.progress).toBeCloseTo(0.25);
    expect(tween.position).toEqual({ x: 2.5, y: 5 });
    time.set(500);
    expect(tween.position).toEqual({ x: 5, y: 10 });
  });

  it("interpolates along a path by cumulative distance", () => {
    const time = fakeClock(0);
    const tween = new Tween(
      {
        from: { x: 0, y: 0 },
        path: [
          { x: 5, y: 0 },
          { x: 5, y: 5 },
        ],
        startedAt: 0,
        durationMs: 1_000,
      },
      time.clock,
    );
    time.set(500);
    expect(tween.position).toEqual({ x: 5, y: 0 });
    time.set(750);
    expect(tween.position.x).toBeCloseTo(5);
    expect(tween.position.y).toBeCloseTo(2.5);
  });

  it("drops a repeated waypoint so distance is measured on the real path", () => {
    const time = fakeClock(0);
    const tween = new Tween(
      {
        from: { x: 0, y: 0 },
        path: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        startedAt: 0,
        durationMs: 1_000,
      },
      time.clock,
    );
    time.set(500);
    expect(tween.position).toEqual({ x: 5, y: 0 });
  });

  it("stays at the start for an empty path", () => {
    const time = fakeClock(0);
    const tween = new Tween(
      { from: { x: 3, y: 4 }, path: [], startedAt: 0, durationMs: 1_000 },
      time.clock,
    );
    time.set(500);
    expect(tween.progress).toBe(0.5);
    expect(tween.position).toEqual({ x: 3, y: 4 });
  });

  it("jumps straight to the end under reduced motion", () => {
    const time = fakeClock(0);
    const tween = new Tween(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 20 }, startedAt: 0, durationMs: 1_000 },
      time.clock,
      { reducedMotion: () => true },
    );
    time.set(100);
    expect(tween.progress).toBe(1);
    expect(tween.position).toEqual({ x: 10, y: 20 });
  });

  it("treats a zero duration as finished", () => {
    const time = fakeClock(0);
    const tween = new Tween(
      { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, startedAt: 0, durationMs: 0 },
      time.clock,
    );
    expect(tween.progress).toBe(1);
    expect(tween.position).toEqual({ x: 1, y: 1 });
  });

  it("ticks only while an effect reads it", async () => {
    vi.useFakeTimers();
    const time = fakeClock(0);
    const tween = new Tween(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, startedAt: 0, durationMs: 1_000 },
      time.clock,
    );
    expect(vi.getTimerCount()).toBe(0);
    const observed = observe(() => tween.position.x);
    expect(vi.getTimerCount()).toBe(1);
    observed.stop();
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });
});
