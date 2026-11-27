import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Countdown, isUrgent, URGENT_SECONDS } from "../src/countdown.svelte.js";
import { ServerClock } from "../src/serverClock.js";
import { observe } from "./observe.svelte.js";

describe("Countdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the correct seconds at the start", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_060_000,
      () => 1_000_000,
    );
    expect(countdown.secondsLeft).toBe(60);
  });

  // The other tests freeze the clock, so they can't catch a mismatch between the two
  // construction-time Date.now() reads. getServerNowFn runs between them, so advancing
  // the clock here reproduces a real wall clock ticking over mid-construction.
  it("does not overshoot by a second when the clock advances during construction", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_060_000,
      () => {
        vi.setSystemTime(Date.now() + 1);
        return 1_000_000;
      },
    );
    expect(countdown.secondsLeft).toBe(60);
  });

  it("runs its interval only while an effect reads it", async () => {
    const countdown = new Countdown(
      () => 1_060_000,
      () => 1_000_000,
    );
    expect(vi.getTimerCount()).toBe(0);
    const observed = observe(() => countdown.secondsLeft);
    expect(vi.getTimerCount()).toBe(1);
    observed.stop();
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ticks down as time passes", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_060_000,
      () => 1_000_000,
    );
    const observed = observe(() => countdown.secondsLeft);
    vi.advanceTimersByTime(5_000);
    expect(countdown.secondsLeft).toBe(55);
    observed.stop();
  });

  it("never goes below zero", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_030_000,
      () => 1_000_000,
    );
    const observed = observe(() => countdown.secondsLeft);
    vi.advanceTimersByTime(100_000);
    expect(countdown.secondsLeft).toBe(0);
    observed.stop();
  });

  it("reports zero when no timer is set", () => {
    const countdown = new Countdown(
      () => 0,
      () => 0,
    );
    expect(countdown.secondsLeft).toBe(0);
  });

  it("corrects for a skewed client clock", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 2_030_000,
      () => 2_000_000,
    );
    expect(countdown.secondsLeft).toBe(30);
  });

  it("corrects against the shared clock it is given", () => {
    vi.setSystemTime(1_000_000);
    const clock = new ServerClock();
    const countdown = new Countdown(
      () => 1_060_000,
      () => 1_000_000,
      undefined,
      () => 0,
      clock,
    );
    // the shared clock — not a private instance — anchored the reading
    expect(clock.isSynced).toBe(true);
    expect(countdown.secondsLeft).toBe(60);
  });

  it("flags the last ten seconds as urgent", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_000_009_000,
      () => 1_000_000_000,
    );
    expect(countdown.isUrgent).toBe(true);
  });

  it("is not urgent when more than 10 seconds remain", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_000_015_000,
      () => 1_000_000_000,
    );
    expect(countdown.isUrgent).toBe(false);
  });

  it("is expired when serverNow >= phaseEndsAt", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_000_000,
      () => 1_000_000,
    );
    expect(countdown.isExpired).toBe(true);
  });

  it("re-anchors to a newer server time seen on a tick", () => {
    vi.setSystemTime(1_000_000);
    let serverNow = 1_000_000;
    const countdown = new Countdown(
      () => 1_060_000,
      () => serverNow,
    );
    const observed = observe(() => countdown.secondsLeft);
    serverNow = 1_005_000;
    vi.advanceTimersByTime(250);
    expect(countdown.secondsLeft).toBe(55);
    observed.stop();
  });

  it("re-anchors to a newer server time seen when read", () => {
    vi.setSystemTime(1_000_000);
    let serverNow = 1_000_000;
    const countdown = new Countdown(
      () => 1_060_000,
      () => serverNow,
    );
    const observed = observe(() => countdown.secondsLeft);
    serverNow = 1_010_000;
    expect(countdown.secondsLeft).toBe(50);
    observed.stop();
  });

  it("re-anchors to a newer server time on a plain read with no subscriber", () => {
    vi.setSystemTime(1_000_000);
    let serverNow = 1_000_000;
    const countdown = new Countdown(
      () => 1_060_000,
      () => serverNow,
    );
    serverNow = 1_010_000;
    expect(countdown.secondsLeft).toBe(50);
  });

  it("reads the first server time when constructed before it arrived", () => {
    vi.setSystemTime(1_000_000);
    let serverNow = 0;
    const countdown = new Countdown(
      () => 1_060_000,
      () => serverNow,
    );
    expect(countdown.secondsLeft).toBe(0);
    serverNow = 1_000_000;
    expect(countdown.secondsLeft).toBe(60);
  });
});

describe("Countdown while paused", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("freezes at the pause instant and resumes from there once the deadline is shifted", () => {
    vi.setSystemTime(1_000_000);
    let serverNow = 1_000_000;
    let pausedAt = 0;
    let ends = 1_060_000;
    const countdown = new Countdown(
      () => ends,
      () => serverNow,
      250,
      () => pausedAt,
    );
    expect(countdown.secondsLeft).toBe(60);
    serverNow = 1_020_000; // forty seconds left when the host pauses
    pausedAt = 1_020_000;
    expect(countdown.secondsLeft).toBe(40);
    vi.advanceTimersByTime(5_000); // wall time passes while the room is paused
    serverNow = 1_025_000;
    expect(countdown.secondsLeft).toBe(40);
    pausedAt = 0; // resume: the host shifts the deadline by the paused time
    ends = 1_065_000;
    expect(countdown.secondsLeft).toBe(40);
    vi.advanceTimersByTime(3_000);
    serverNow = 1_028_000;
    expect(countdown.secondsLeft).toBe(37);
  });

  it("does not expire while paused, even past the original deadline", () => {
    vi.setSystemTime(1_000_000);
    let serverNow = 1_000_000;
    let pausedAt = 0;
    const countdown = new Countdown(
      () => 1_010_000,
      () => serverNow,
      250,
      () => pausedAt,
    );
    serverNow = 1_009_000; // one second left when the host pauses
    pausedAt = 1_009_000;
    expect(countdown.isExpired).toBe(false);
    vi.advanceTimersByTime(5_000);
    serverNow = 1_014_000; // wall time crossed the deadline while paused
    expect(countdown.secondsLeft).toBe(1);
    expect(countdown.isExpired).toBe(false);
  });

  it("ignores a pause that has no instant (0)", () => {
    vi.setSystemTime(1_000_000);
    const countdown = new Countdown(
      () => 1_060_000,
      () => 1_000_000,
      250,
      () => 0,
    );
    expect(countdown.secondsLeft).toBe(60);
  });
});

describe("isUrgent", () => {
  it("flags only the last ten seconds: zero and beyond ten are not urgent", () => {
    expect(isUrgent(0)).toBe(false);
    expect(isUrgent(1)).toBe(true);
    expect(isUrgent(10)).toBe(true);
    expect(isUrgent(11)).toBe(false);
  });

  it("keeps the shared threshold at ten seconds", () => {
    expect(URGENT_SECONDS).toBe(10);
  });
});
