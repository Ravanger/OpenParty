import { type SchemaType, schema, t } from "@colyseus/schema";
import { actionFactory, defineGame } from "@openparty/core";
import { BaseGameState } from "@openparty/shared/schema";
import { z } from "zod";

/** A tiny per-player private note a slice can reveal to one player. */
export const Note = schema({ note: t.string().default("") }, "Note");

/** One generic slice: a few scalars, per-player scores, and a private per-player note map. */
export const Slice = schema(
  {
    round: t.number().default(0),
    label: t.string().default(""),
    scores: t.map("number"),
    payload: t.string().default(""),
    mine: t.map(Note).view(),
  },
  "Slice",
);

/** One generic slice on the state class; nested classes are not checked by `assertSyncedFields`. */
export const SliceState = BaseGameState.extend({ slice: Slice }, "SliceState");
export type SliceState = SchemaType<typeof SliceState>;
export const SLICE_PUBLIC_FIELDS = ["slice"] as const;

const action = actionFactory<SliceState, Record<string, never>, Record<string, unknown>>();

/** Fills the slice in place on module entry; notes are revealed per player. */
export const SliceGame = defineGame<SliceState, Record<string, never>, Record<string, unknown>>({
  name: "Slice",
  version: "1",
  minPlayers: 1,
  maxPlayers: 2,
  startPhase: "Play",
  autoStart: true,
  createPrivateState: () => ({}),
  options: z.object({}),
  phases: {
    Play: {
      actions: {
        SET_MODULE: action({
          from: "player",
          payload: z.object({}),
          handler: (ctx) => {
            const slice = ctx.state.slice;
            const players = ctx.activePlayers();
            slice.round = 1;
            slice.label = "round-1";
            slice.scores.clear();
            let total = 0;
            for (const [index, player] of players.entries()) {
              const points = (index + 1) * 10;
              slice.scores.set(player.id, points);
              total += points;
            }
            slice.payload = JSON.stringify({ total });
            for (const player of players) {
              const note = new Note();
              note.note = `note-${player.id}`;
              slice.mine.set(player.id, note);
              ctx.showTo(player.id, note);
            }
          },
        }),
      },
    },
  },
});
