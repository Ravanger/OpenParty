import { describe, expect, it } from "vitest";
import { PausableClock } from "../../src/runtime/PausableClock.js";
import { FakeHost } from "../../src/testing/index.js";

describe("PausableClock", () => {
  it("clearTimeout with non-existent handle is a no-op", () => {
    const host = new FakeHost();
    const clock = new PausableClock(host);
    expect(() => clock.clearTimeout(999999 as never)).not.toThrow();
  });

  it("pause() twice keeps the remembered remainder, not a stale recompute", () => {
    const host = new FakeHost();
    const clock = new PausableClock(host);
    let fired = false;
    clock.setTimeout(() => {
      fired = true;
    }, 1000);
    host.advance(200); // 800ms left
    clock.pause();
    host.advance(500); // paused; wall time moves on
    clock.pause(); // must be a no-op, not a recompute against the stale dueAt
    expect(fired).toBe(false);
    clock.resume();
    host.advance(799); // not yet: only 800ms remain
    expect(fired).toBe(false);
    host.advance(1); // 800ms after resume: fires
    expect(fired).toBe(true);
  });

  it("resume() on already-running timers is a no-op (timer.handle !== undefined path)", () => {
    const host = new FakeHost();
    const clock = new PausableClock(host);
    clock.setTimeout(() => {}, 1000);
    expect(() => clock.resume()).not.toThrow();
  });

  it("pause/resume preserves remaining time", () => {
    const host = new FakeHost();
    const clock = new PausableClock(host);
    let fired = false;
    clock.setTimeout(() => {
      fired = true;
    }, 500);
    host.advance(200);
    clock.pause();
    host.advance(1000); // Should not fire while paused
    expect(fired).toBe(false);
    clock.resume();
    host.advance(300); // 200 + 300 = 500ms total
    expect(fired).toBe(true);
  });
});
