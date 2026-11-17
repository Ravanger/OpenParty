import type { PlayerInfo } from "@openparty/core";
import { defaultCoreStrings, noopLogger } from "@openparty/core";
import { WitClashOptionsSchema } from "../../src/options.js";
import { type WitClashContext, WitClashPrivate } from "../../src/private.js";
import { WitClashState } from "../../src/state.js";
import { makeCategories } from "./support.js";

/** One seat as the host reports it: connected, ready and active unless overridden. */
export const seat = (id: string, overrides: Partial<PlayerInfo> = {}): PlayerInfo => ({
  id,
  name: `Name ${id}`,
  role: "player",
  isConnected: true,
  isReady: true,
  isActive: true,
  ...overrides,
});

/** What {@link makeCtx} returns: the context plus the transitions it queued. */
export interface CtxFixture {
  ctx: WitClashContext;
  /** Phase names queued through `ctx.transition`, in order. */
  transitions: string[];
}

/**
 * A hand-built context over real state and private objects — no runtime, no mocks. `players` are
 * the seats as given; `activePlayers` filters them exactly like the runtime does.
 */
export function makeCtx(seats: PlayerInfo[]): CtxFixture {
  const state = new WitClashState();
  const priv = new WitClashPrivate(makeCategories(), makeCategories());
  const transitions: string[] = [];
  let ids = 0;
  const ctx: WitClashContext = {
    state,
    priv,
    options: WitClashOptionsSchema.parse({}),
    phase: "MatchupVoting",
    players: () => seats,
    activePlayers: () => seats.filter((p) => p.isConnected && p.isReady && p.isActive),
    player: (id) => seats.find((p) => p.id === id),
    activateWaitingPlayers: () => {},
    send: () => {},
    broadcast: () => {},
    showTo: () => {},
    hideFrom: () => {},
    transition: (phase) => {
      transitions.push(phase);
    },
    returnToLobby: () => {},
    rng: () => 0.5,
    newId: () => `id-${++ids}`,
    now: () => 1_000_000,
    log: noopLogger,
    gameName: "WitClash",
    gameVersion: "1",
    seed: [1, 2, 3, 4],
    strings: defaultCoreStrings,
  };
  return { ctx, transitions };
}
