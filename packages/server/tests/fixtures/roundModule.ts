import { type SchemaType, schema, t } from "@colyseus/schema";
import { defineGame } from "@openparty/core";
import {
  defineRoundModule,
  mountRoundModule,
  roundModuleActionFactory,
} from "@openparty/core/kits";
import { BaseGameState } from "@openparty/shared/schema";
import { z } from "zod";

/** The module's slice: one tap count per player. */
export const RoundSlice = schema({ taps: t.map("number") }, "RoundSlice");
export type RoundSlice = SchemaType<typeof RoundSlice>;

/** Host state: the module's slice plus the host's own bookkeeping. */
export const ModuleState = BaseGameState.extend(
  { round: RoundSlice, total: t.number().default(0) },
  "ModuleState",
);
export type ModuleState = SchemaType<typeof ModuleState>;
export const MODULE_PUBLIC_FIELDS = ["round", "total"] as const;

type ModulePrivate = Record<string, never>;
type ModuleResult = { total: number };

const action = roundModuleActionFactory<RoundSlice, ModulePrivate, Record<string, unknown>>();

/** A tiny round module: a timed Tap phase whose `TAP` action counts taps, then a Reveal phase
 * whose timeout finishes the module; the host's `onDone` records the total and clears the way. */
const tapModule = defineRoundModule<
  RoundSlice,
  ModulePrivate,
  Record<string, unknown>,
  ModuleResult
>({
  id: "tap",
  enter: (ctx) => {
    ctx.state.taps.clear();
  },
  phases: {
    Tap: {
      duration: 1200,
      onTimeout: (ctx) => ctx.transition("Reveal"),
      actions: {
        TAP: action({
          from: "player",
          payload: z.object({}),
          handler: (ctx) => {
            const current = ctx.state.taps.get(ctx.playerId) ?? 0;
            ctx.state.taps.set(ctx.playerId, current + 1);
          },
        }),
      },
    },
    Reveal: {
      duration: 500,
      onTimeout: (ctx) => ctx.finish(),
    },
  },
  result: (ctx) => ({ total: [...ctx.state.taps.values()].reduce((sum, n) => sum + n, 0) }),
});

/** A host game mounting the tap module under the MOD prefix, from the first declared phase. */
export const ModuleGame = defineGame<ModuleState, ModulePrivate, Record<string, unknown>>({
  name: "Module",
  version: "1",
  minPlayers: 2,
  maxPlayers: 3,
  startPhase: "MOD_Tap",
  autoStart: true,
  createPrivateState: () => ({}),
  options: z.object({}),
  phases: {
    ...mountRoundModule(tapModule, {
      prefix: "MOD",
      slice: (state) => state.round,
      priv: (priv) => priv,
      params: {},
      onDone: (ctx, result) => {
        ctx.state.total = result.total;
        ctx.transition("Done");
      },
    }),
    Done: {},
  },
});
