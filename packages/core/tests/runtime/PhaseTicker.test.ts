import { describe, expect, it } from "vitest";
import {
  defaultCoreStrings,
  type GameContext,
  noopLogger,
  type PhaseDefinition,
  type PhaseState,
} from "../../src/index.js";
import { PhaseTicker } from "../../src/runtime/PhaseTicker.js";
import { FakeHost } from "../../src/testing/FakeHost.js";

interface TickState extends PhaseState {
  calls: number;
  dts: number[];
}
type TickPriv = Record<string, never>;
type TickOptions = Record<string, never>;
type Ticker = PhaseTicker<TickState, TickPriv, TickOptions>;
type TickPhase = PhaseDefinition<TickState, TickPriv, TickOptions>;

const state = (): TickState => ({
  phase: "",
  phaseEndsAt: 0,
  phaseDurationMs: 0,
  canStart: false,
  calls: 0,
  dts: [],
});

const contextOf = (s: TickState): GameContext<TickState, TickPriv, TickOptions> => ({
  state: s,
  priv: {},
  options: {},
  phase: "Ticking",
  players: () => [],
  activePlayers: () => [],
  player: () => undefined,
  activateWaitingPlayers: () => {},
  send: () => {},
  broadcast: () => {},
  showTo: () => {},
  hideFrom: () => {},
  transition: () => {},
  returnToLobby: () => {},
  rng: () => 0.5,
  newId: () => "id",
  now: () => 0,
  log: noopLogger,
  gameName: "Tick",
  gameVersion: "1",
  seed: [0, 0, 0, 0],
  strings: defaultCoreStrings,
});

const makeTicker = (): { ticker: Ticker; host: FakeHost; s: TickState } => {
  const host = new FakeHost();
  const s = state();
  const ticker = new PhaseTicker<TickState, TickPriv, TickOptions>({
    host,
    run: (fn) => fn(),
    context: () => contextOf(s),
  });
  return { ticker, host, s };
};

const ticking = (tickMs?: number): TickPhase => ({
  onTick: (ctx, dtMs) => {
    ++ctx.state.calls;
    ctx.state.dts.push(dtMs);
  },
  ...(tickMs === undefined ? {} : { tickMs }),
});

describe("PhaseTicker", () => {
  it("arms the first tick one interval after entry at the default rate", () => {
    const { ticker, host, s } = makeTicker();
    ticker.start(ticking());
    expect(host.pendingTimers).toBe(1);
    host.advance(99);
    expect(s.calls).toBe(0);
    host.advance(1);
    expect(s.calls).toBe(1);
    expect(s.dts).toEqual([100]);
  });

  it("honours a per-phase tickMs", () => {
    const { ticker, host, s } = makeTicker();
    ticker.start(ticking(250));
    host.advance(249);
    expect(s.calls).toBe(0);
    host.advance(1);
    expect(s.dts).toEqual([250]);
  });

  it("keeps tick k due at enter + k·tickMs without carrying a late delivery", () => {
    const { ticker, host, s } = makeTicker();
    ticker.start(ticking(100));
    host.timerLatenessMs = 5; // every timer fires 5 ms late
    host.advance(400);
    expect(s.calls).toBe(3); // at +105, +205, +305
    host.advance(10);
    expect(s.calls).toBe(4); // the +400 tick still lands at +405, not +410
    host.advance(95);
    expect(s.calls).toBe(5); // and the next one is due at +505, not later
    expect(host.pendingTimers).toBe(1);
  });

  it("clears the pending timer and stops rescheduling", () => {
    const { ticker, host, s } = makeTicker();
    ticker.start(ticking());
    host.advance(100);
    expect(s.calls).toBe(1);
    ticker.clear();
    expect(host.pendingTimers).toBe(0);
    host.advance(10_000);
    expect(s.calls).toBe(1);
  });

  it("clears nothing when no timer is pending", () => {
    const { ticker, host } = makeTicker();
    ticker.clear();
    expect(host.pendingTimers).toBe(0);
  });

  it("does not arm anything for a phase without onTick", () => {
    const quiet: TickPhase = {};
    const { ticker, host } = makeTicker();
    ticker.start(quiet);
    expect(host.pendingTimers).toBe(0);
    host.advance(10_000);
    expect(ticker.count).toBe(0);
  });

  it("counts fired ticks and reset() clears the pending timer with the count", () => {
    const { ticker, host, s } = makeTicker();
    ticker.start(ticking());
    host.advance(250);
    expect(s.calls).toBe(2);
    expect(ticker.count).toBe(2);
    ticker.reset();
    expect(host.pendingTimers).toBe(0);
    expect(ticker.count).toBe(0);
  });
});
