import { actionFactory, defineGame } from "@openparty/core";
import type { BaseGameState } from "@openparty/shared/schema";
import { z } from "zod";

interface RatedPrivate {
  fast: number;
  slow: number;
  plain: number;
  cheer: number;
  vote: number;
  tap: number;
}

const action = actionFactory<BaseGameState, RatedPrivate, Record<string, unknown>>();

/** A wide burst for an action that must outlast the shared bucket a test configures. */
const FAST_LIMIT = { rate: 50, burst: 60 };

/** A bucket that refills far too slowly to matter within one test. */
const STUCK_LIMIT = { rate: 0.0001, burst: 1 };

/** About 12 taps per second, the figure the #306/#448 docs example pins for a real-time tap game. */
const TAP_LIMIT = { rate: 12, burst: 12 };

/** Two seats; every action shape a per-action limit test needs: own bucket, low bucket, no bucket. */
export const RatedGame = defineGame<BaseGameState, RatedPrivate, Record<string, unknown>>({
  name: "Rated",
  version: "1",
  minPlayers: 2,
  maxPlayers: 2,
  startPhase: "Play",
  autoStart: true,
  createPrivateState: () => ({ fast: 0, slow: 0, plain: 0, cheer: 0, vote: 0, tap: 0 }),
  phases: {
    Play: {
      actions: {
        FAST: action({
          from: "player",
          payload: z.object({}),
          rateLimit: FAST_LIMIT,
          handler: (ctx) => {
            ++ctx.priv.fast;
          },
        }),
        SLOW: action({
          from: "player",
          payload: z.object({}),
          rateLimit: STUCK_LIMIT,
          handler: (ctx) => {
            ++ctx.priv.slow;
          },
        }),
        PLAIN: action({
          from: "player",
          payload: z.object({}),
          handler: (ctx) => {
            ++ctx.priv.plain;
          },
        }),
        CHEER: action({
          from: "audience",
          payload: z.object({}),
          rateLimit: FAST_LIMIT,
          handler: (ctx) => {
            ++ctx.priv.cheer;
          },
        }),
        VOTE: action({
          from: "audience",
          payload: z.object({}),
          handler: (ctx) => {
            ++ctx.priv.vote;
          },
        }),
        TAP: action({
          from: "player",
          payload: z.object({}),
          rateLimit: TAP_LIMIT,
          handler: (ctx) => {
            ++ctx.priv.tap;
          },
        }),
      },
    },
  },
});
