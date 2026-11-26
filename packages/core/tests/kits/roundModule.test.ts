import { ErrorCode } from "@openparty/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type ActionLog,
  actionFactory,
  actionLogMiddleware,
  defineGame,
  type GameContext,
  type GameDefinition,
  GameDefinitionError,
  getActionLog,
  type PhaseState,
  required,
} from "../../src/index.js";
import {
  defineRoundModule,
  mountRoundModule,
  type RoundModule,
  type RoundModuleContext,
  roundModuleActionFactory,
} from "../../src/kits/roundModule.js";
import { replayLog } from "../../src/replay/index.js";
import { TestTable } from "../../src/testing/TestTable.js";

// Compile-time exactness: this alias fails to compile when the two types differ.
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

interface TapSlice {
  taps: Record<string, number>;
  lucky: number;
}
interface TapPriv {
  drawn: string;
}
interface TapParams {
  limit: number;
}
interface TapResult {
  total: number;
  winner: string;
}

const action = roundModuleActionFactory<TapSlice, TapPriv, TapParams>();

/** The phase names the module hooks saw, in order (local, unprefixed). */
const seenPhases: string[] = [];

/** A tiny test module: players tap until they reach the limit or the phase times out; the reveal draws a winner among the tappers. */
const tapModule = defineRoundModule<TapSlice, TapPriv, TapParams, TapResult>({
  id: "tap",
  enter: (ctx) => {
    // Compile-time: the module sees only its slices, never the host state or private state.
    type _stateIsTheSlice = Expect<IsExact<typeof ctx.state, TapSlice>>;
    type _privIsThePrivSlice = Expect<IsExact<typeof ctx.priv, TapPriv>>;
    const narrowed: RoundModuleContext<TapSlice, TapPriv, TapParams> = ctx;
    expect(narrowed.params.limit).toBeGreaterThan(0);
    ctx.state.taps = {};
    ctx.state.lucky = 0;
    ctx.priv.drawn = "";
  },
  phases: {
    Tap: {
      duration: 1000,
      onEnter: (ctx) => seenPhases.push(ctx.phase),
      onTimeout: (ctx) => ctx.transition("Reveal"),
      actions: {
        TAP: action({
          from: "player",
          payload: z.object({}),
          handler: (ctx) => {
            const next = Math.min((ctx.state.taps[ctx.playerId] ?? 0) + 1, ctx.params.limit);
            ctx.state.taps[ctx.playerId] = next;
            if (next === ctx.params.limit) ctx.finish();
          },
        }),
      },
    },
    Reveal: {
      duration: 500,
      onEnter: (ctx) => {
        seenPhases.push(ctx.phase);
        ctx.state.lucky = ctx.rng();
        const ids = Object.keys(ctx.state.taps);
        ctx.priv.drawn = ids.length > 0 ? (ids[Math.floor(ctx.rng() * ids.length)] ?? "") : "";
      },
      onTimeout: (ctx) => ctx.finish(),
    },
  },
  result: (ctx) => ({
    total: Object.values(ctx.state.taps).reduce((sum, n) => sum + n, 0),
    winner: ctx.priv.drawn,
  }),
});

interface NoteSlice {
  notes: string[];
  ticks: number;
}
interface NotePriv {
  seen: boolean;
}
interface NoteParams {
  per: number;
}
interface NoteResult {
  count: number;
}

const noteAction = roundModuleActionFactory<NoteSlice, NotePriv, NoteParams>();

/** What Hold's onRosterChange observed, for the assertions. */
let holdInfo: { seats: number; active: number; gone: boolean; id: string; at: number } | undefined;
/** The local phase names noteModule's onRosterChange saw, in order. */
const rosterPhases: string[] = [];

/** A second test module exercising the forwarded context surface: a computed duration with ticks, a free-text action, and a host-only exit. */
const noteModule = defineRoundModule<NoteSlice, NotePriv, NoteParams, NoteResult>({
  id: "note",
  phases: {
    Write: {
      duration: (ctx) => ctx.params.per * 10,
      tickMs: 10,
      onEnter: (ctx) => {
        ctx.state.notes = [];
        ctx.state.ticks = 0;
      },
      onTick: (ctx, dtMs) => {
        ctx.state.ticks += dtMs / 10;
      },
      onTimeout: (ctx) => ctx.transition("Hold"),
      actions: {
        SAY: noteAction({
          from: "player",
          payload: z.object({ body: z.string() }),
          textFields: ["body"],
          handler: (ctx) => {
            ctx.state.notes.push(ctx.payload.body);
          },
        }),
        CANCEL: noteAction({
          from: "player",
          payload: z.object({}),
          handler: (ctx) => ctx.reject(ErrorCode.NOT_ALLOWED, "not now"),
        }),
      },
    },
    Hold: {
      onRosterChange: (ctx) => {
        rosterPhases.push(ctx.phase);
        holdInfo = {
          seats: ctx.players().length,
          active: ctx.activePlayers().length,
          gone: ctx.player("p4") === undefined,
          id: ctx.newId(),
          at: ctx.now(),
        };
        ctx.broadcast("ROSTER_CHANGED", { seats: holdInfo.seats });
        ctx.send("p1", "NOTE_LEFT", {});
        ctx.showTo("p2", ctx.state);
        ctx.hideFrom("p3", ctx.state);
      },
      actions: {
        DONE: noteAction({
          from: "host",
          payload: z.object({}),
          handler: (ctx) => ctx.finish(),
        }),
        BAIL: noteAction({
          from: "host",
          payload: z.object({}),
          handler: (ctx) => ctx.returnToLobby(),
        }),
      },
    },
  },
  result: (ctx) => ({ count: ctx.state.notes.length }),
});

interface HostState extends PhaseState {
  slice: TapSlice;
  total: number;
}
interface HostPriv {
  mod: TapPriv;
  hostNote: string;
}
type HostOptions = Record<string, unknown>;

const hostAction = actionFactory<HostState, HostPriv, HostOptions>();

const newHostState = (): HostState => ({
  phase: "",
  phaseEndsAt: 0,
  phaseDurationMs: 0,
  canStart: false,
  slice: { taps: {}, lucky: 0 },
  total: 0,
});

interface NoteHostState extends PhaseState {
  slice: NoteSlice;
  total: number;
}
interface NoteHostPriv {
  mod: NotePriv;
}
type NoteHostOptions = Record<string, unknown>;

const noteHostAction = actionFactory<NoteHostState, NoteHostPriv, NoteHostOptions>();

const newNoteHostState = (): NoteHostState => ({
  phase: "",
  phaseEndsAt: 0,
  phaseDurationMs: 0,
  canStart: false,
  slice: { notes: [], ticks: 0 },
  total: 0,
});

type OnDone = (ctx: GameContext<HostState, HostPriv, HostOptions>, result: TapResult) => void;

/** A host game with the tap module mounted under `prefix`; Ready's GO action enters it. */
function buildGame(
  prefix: string,
  onDone: OnDone,
): GameDefinition<HostState, HostPriv, HostOptions> {
  return defineGame<HostState, HostPriv, HostOptions>({
    name: "TapHost",
    version: "1",
    minPlayers: 1,
    maxPlayers: 4,
    startPhase: "Ready",
    createPrivateState: () => ({ mod: { drawn: "" }, hostNote: "h" }),
    phases: {
      Ready: {
        actions: {
          GO: hostAction({
            from: "host",
            payload: z.object({}),
            handler: (ctx) => ctx.transition(`${prefix}_Tap`),
          }),
        },
      },
      ...mountRoundModule(tapModule, {
        prefix,
        slice: (state: HostState) => state.slice,
        priv: (priv: HostPriv) => priv.mod,
        params: { limit: 2 },
        onDone,
      }),
      Scored: {},
    },
  });
}

const thrownBy = <T>(fn: () => T): GameDefinitionError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GameDefinitionError);
    return error as GameDefinitionError;
  }
  throw new Error("expected a GameDefinitionError");
};

describe("defineRoundModule", () => {
  it("returns a well-formed module unchanged", () => {
    expect(defineRoundModule(tapModule)).toBe(tapModule);
  });

  it("lists every problem in one GameDefinitionError", () => {
    const error = thrownBy(() =>
      defineRoundModule<TapSlice, TapPriv, TapParams, TapResult>({
        id: "",
        phases: {
          "9Bad": {},
          Lobby: {},
          Ok: {
            actions: {
              START_GAME: action({ from: "player", payload: z.object({}), handler: () => {} }),
              tap: action({ from: "player", payload: z.object({}), handler: () => {} }),
            },
          },
        },
        result: () => ({ total: 0, winner: "" }),
      }),
    );
    expect(error.problems).toEqual([
      "id must not be empty",
      'phase name "9Bad" is invalid',
      '"Lobby" is reserved and built in',
      "START_GAME is reserved and built in",
      'action name "tap" is invalid',
    ]);
  });

  it("rejects module actions named after reserved built-ins", () => {
    const error = thrownBy(() =>
      defineRoundModule<TapSlice, TapPriv, TapParams, TapResult>({
        id: "reserved",
        phases: {
          Tap: {
            actions: {
              PAUSE_GAME: action({ from: "player", payload: z.object({}), handler: () => {} }),
              RESUME_GAME: action({ from: "player", payload: z.object({}), handler: () => {} }),
            },
          },
        },
        result: () => ({ total: 0, winner: "" }),
      }),
    );
    expect(error.problems).toEqual([
      "PAUSE_GAME is reserved and built in",
      "RESUME_GAME is reserved and built in",
    ]);
  });

  it("rejects a module without phases", () => {
    const error = thrownBy(() =>
      defineRoundModule<TapSlice, TapPriv, TapParams, TapResult>({
        id: "empty",
        phases: {},
        result: () => ({ total: 0, winner: "" }),
      }),
    );
    expect(error.problems).toEqual(["phases must not be empty"]);
  });
});

describe("mountRoundModule", () => {
  const mount = (prefix: string) =>
    mountRoundModule(tapModule, {
      prefix,
      slice: (state: HostState) => state.slice,
      priv: (priv: HostPriv) => priv.mod,
      params: { limit: 2 },
      onDone: () => {},
    });

  it("returns one host phase per module phase, prefixed", () => {
    expect(Object.keys(mount("PH"))).toEqual(["PH_Tap", "PH_Reveal"]);
  });

  it("throws for an empty prefix", () => {
    const error = thrownBy(() => mount(""));
    expect(error.problems).toEqual(["prefix must not be empty"]);
  });

  it("throws when the same module is mounted twice under one prefix", () => {
    mount("DUP");
    const error = thrownBy(() => mount("DUP"));
    expect(error.problems).toEqual(['module "tap" is already mounted with prefix "DUP"']);
  });

  it("throws when a prefixed phase name fails the phase-name rule", () => {
    const error = thrownBy(() => mount("mod-x"));
    expect(error.problems).toEqual([
      'prefixed phase name "mod-x_Tap" is invalid',
      'prefixed phase name "mod-x_Reveal" is invalid',
      'prefixed action name "MOD-X__TAP" is invalid',
    ]);
  });

  it("throws when a prefixed action name is over 64 characters", () => {
    const prefix = "A".repeat(60);
    const error = thrownBy(() => mount(prefix));
    expect(error.problems).toEqual([`prefixed action name "${prefix}__TAP" is invalid`]);
  });

  it("does not track duplicate mounts for a module that never went through defineRoundModule", () => {
    const raw: RoundModule<TapSlice, TapPriv, TapParams, Record<string, never>> = {
      id: "raw",
      phases: { Solo: {} },
      result: () => ({}),
    };
    const options = {
      prefix: "RAW",
      slice: (state: HostState) => state.slice,
      priv: (priv: HostPriv) => priv.mod,
      params: { limit: 1 },
      onDone: () => {},
    };
    expect(Object.keys(mountRoundModule(raw, options))).toEqual(["RAW_Solo"]);
    expect(Object.keys(mountRoundModule(raw, options))).toEqual(["RAW_Solo"]);
  });
});

describe("running a mounted module", () => {
  it("runs the module's phases under prefixed names and hands the result to onDone with the host context", () => {
    const results: TapResult[] = [];
    let stateSeenByOnDone: unknown;
    const definition = buildGame("MOD", (ctx, result) => {
      type _stateIsTheHostState = Expect<IsExact<typeof ctx.state, HostState>>;
      stateSeenByOnDone = ctx.state;
      results.push(result);
      ctx.state.total = result.total;
      ctx.transition("Scored");
    });
    const table = new TestTable<HostState, HostPriv, HostOptions>({
      definition,
      // Stale slice data: the module's enter must reset it.
      state: { ...newHostState(), slice: { taps: { p9: 7 }, lucky: 0.5 } },
      options: {},
    });
    expect(table.start()).toBeUndefined();
    expect(table.phase).toBe("Ready");
    expect(table.act("p1", "GO")).toBeUndefined();
    expect(table.phase).toBe("MOD_Tap");
    expect(table.state.slice.taps).toEqual({});
    expect(table.state.slice.lucky).toBe(0);

    expect(table.act("p2", "MOD__TAP")).toBeUndefined();
    expect(table.state.slice.taps).toEqual({ p2: 1 });
    expect(table.phase).toBe("MOD_Tap");
    expect(table.state.total).toBe(0);

    // The second tap reaches the limit: finish runs onDone with the host context.
    expect(table.act("p2", "MOD__TAP")).toBeUndefined();
    expect(table.phase).toBe("Scored");
    expect(results).toEqual([{ total: 2, winner: "" }]);
    expect(stateSeenByOnDone).toBe(table.state);
    expect(table.state.total).toBe(2);

    expect(table.host.transitions).toContainEqual({ from: "Ready", to: "MOD_Tap" });
    expect(table.host.transitions).toContainEqual({ from: "MOD_Tap", to: "Scored" });
  });

  it("moves between the module's own phases with local names and draws from the room RNG", () => {
    const definition = buildGame("RT", (ctx, result) => {
      ctx.state.total = result.total;
      ctx.transition("Scored");
    });
    const table = new TestTable<HostState, HostPriv, HostOptions>({
      definition,
      state: newHostState(),
      options: {},
    });
    seenPhases.length = 0;
    expect(table.start()).toBeUndefined();
    expect(table.act("p1", "GO")).toBeUndefined();
    expect(table.phase).toBe("RT_Tap");
    expect(table.act("p2", "RT__TAP")).toBeUndefined();

    table.tick(1000); // Tap times out: the local name maps to RT_Reveal.
    expect(table.phase).toBe("RT_Reveal");
    expect(seenPhases).toEqual(["Tap", "Reveal"]);
    expect(table.state.slice.lucky).toBeGreaterThanOrEqual(0);
    expect(table.state.slice.lucky).toBeLessThan(1);
    expect(table.priv.mod.drawn).toBe("p2");

    table.tick(500); // Reveal times out: finish, onDone, Scored.
    expect(table.phase).toBe("Scored");
    expect(table.state.total).toBe(1);
  });

  it("mounts the same module twice under different prefixes in one game", () => {
    const results: TapResult[] = [];
    const definition = defineGame<HostState, HostPriv, HostOptions>({
      name: "TapHost",
      version: "1",
      minPlayers: 1,
      maxPlayers: 4,
      startPhase: "Ready",
      createPrivateState: () => ({ mod: { drawn: "" }, hostNote: "h" }),
      phases: {
        Ready: {
          actions: {
            GO_A: hostAction({
              from: "host",
              payload: z.object({}),
              handler: (ctx) => ctx.transition("ALPHA_Tap"),
            }),
          },
        },
        ...mountRoundModule(tapModule, {
          prefix: "ALPHA",
          slice: (state: HostState) => state.slice,
          priv: (priv: HostPriv) => priv.mod,
          params: { limit: 2 },
          onDone: (ctx, result) => {
            results.push(result);
            ctx.state.total += result.total;
            ctx.transition("Mid");
          },
        }),
        Mid: {
          actions: {
            GO_B: hostAction({
              from: "host",
              payload: z.object({}),
              handler: (ctx) => ctx.transition("BETA_Tap"),
            }),
          },
        },
        ...mountRoundModule(tapModule, {
          prefix: "BETA",
          slice: (state: HostState) => state.slice,
          priv: (priv: HostPriv) => priv.mod,
          params: { limit: 2 },
          onDone: (ctx, result) => {
            results.push(result);
            ctx.state.total += result.total;
            ctx.transition("Scored");
          },
        }),
        Scored: {},
      },
    });
    const table = new TestTable<HostState, HostPriv, HostOptions>({
      definition,
      state: newHostState(),
      options: {},
    });
    expect(table.start()).toBeUndefined();
    expect(table.act("p1", "GO_A")).toBeUndefined();
    expect(table.phase).toBe("ALPHA_Tap");
    expect(table.state.slice.taps).toEqual({});
    expect(table.act("p2", "ALPHA__TAP")).toBeUndefined();
    expect(table.act("p2", "ALPHA__TAP")).toBeUndefined();
    expect(table.phase).toBe("Mid");
    expect(table.state.slice.taps).toEqual({ p2: 2 });

    expect(table.act("p1", "GO_B")).toBeUndefined();
    expect(table.phase).toBe("BETA_Tap");
    expect(table.state.slice.taps).toEqual({}); // enter ran again for the second mount
    expect(table.act("p3", "BETA__TAP")).toBeUndefined();
    expect(table.act("p3", "BETA__TAP")).toBeUndefined();
    expect(table.phase).toBe("Scored");

    expect(results.map((r) => r.total)).toEqual([2, 2]);
    expect(table.state.total).toBe(4);
    expect(table.host.transitions).toContainEqual({ from: "ALPHA_Tap", to: "Mid" });
    expect(table.host.transitions).toContainEqual({ from: "BETA_Tap", to: "Scored" });
  });

  it("forwards ticks, roster changes and the forwarded context surface to module hooks", () => {
    const definition = defineGame<NoteHostState, NoteHostPriv, NoteHostOptions>({
      name: "NoteHost",
      version: "1",
      minPlayers: 1,
      maxPlayers: 4,
      startPhase: "Ready",
      createPrivateState: () => ({ mod: { seen: false } }),
      phases: {
        Ready: {
          actions: {
            GO: noteHostAction({
              from: "host",
              payload: z.object({}),
              handler: (ctx) => ctx.transition("NOTE_Write"),
            }),
          },
        },
        ...mountRoundModule(noteModule, {
          prefix: "NOTE",
          slice: (state: NoteHostState) => state.slice,
          priv: (priv: NoteHostPriv) => priv.mod,
          params: { per: 3 },
          onDone: (ctx, result) => {
            ctx.state.total = result.count;
            ctx.transition("Scored");
          },
        }),
        Scored: {},
      },
    });
    const table = new TestTable<NoteHostState, NoteHostPriv, NoteHostOptions>({
      definition,
      // Stale slice data: the phase's onEnter must reset it.
      state: { ...newNoteHostState(), slice: { notes: ["stale"], ticks: 9 } },
      options: {},
    });
    expect(table.start()).toBeUndefined();
    expect(table.act("p1", "GO")).toBeUndefined();
    expect(table.phase).toBe("NOTE_Write");
    expect(table.state.phaseDurationMs).toBe(30); // computed duration: per * 10
    expect(table.state.slice.notes).toEqual([]);

    expect(table.act("p2", "NOTE__SAY", { body: "hi" })).toBeUndefined();
    expect(table.state.slice.notes).toEqual(["hi"]);

    const refused = table.act("p2", "NOTE__CANCEL"); // reject is forwarded to the host context
    expect(refused?.code).toBe(ErrorCode.NOT_ALLOWED);

    table.tick(15); // one onTick at +10, dtMs 10
    expect(table.phase).toBe("NOTE_Write");
    expect(table.state.slice.ticks).toBe(1);

    table.tick(20); // the tick at +20 and the timeout at +30: into NOTE_Hold
    expect(table.phase).toBe("NOTE_Hold");
    expect(table.state.slice.ticks).toBe(2);

    rosterPhases.length = 0;
    table.leave("p4");
    expect(rosterPhases).toEqual(["Hold"]); // the local phase name
    expect(holdInfo).toMatchObject({ seats: 3, active: 3, gone: true });
    expect(holdInfo?.id.length).toBeGreaterThan(0);
    expect(holdInfo?.at).toBeGreaterThanOrEqual(1_000_000);
    expect(table.host.broadcasts).toContainEqual({ type: "ROSTER_CHANGED", payload: { seats: 3 } });
    expect(table.host.sent.some((s) => s.playerId === "p1" && s.type === "NOTE_LEFT")).toBe(true);
    expect(table.host.views).toContainEqual(
      expect.objectContaining({ op: "show", playerId: "p2" }),
    );
    expect(table.host.views).toContainEqual(
      expect.objectContaining({ op: "hide", playerId: "p3" }),
    );

    expect(table.act("p1", "NOTE__DONE")).toBeUndefined();
    expect(table.phase).toBe("Scored");
    expect(table.state.total).toBe(1);
    expect(table.host.transitions).toContainEqual({ from: "NOTE_Write", to: "NOTE_Hold" });
    expect(table.host.transitions).toContainEqual({ from: "NOTE_Hold", to: "Scored" });
  });

  it("leaves for the lobby through returnToLobby without finishing", () => {
    const definition = defineGame<NoteHostState, NoteHostPriv, NoteHostOptions>({
      name: "NoteHost",
      version: "1",
      minPlayers: 1,
      maxPlayers: 4,
      startPhase: "Ready",
      createPrivateState: () => ({ mod: { seen: false } }),
      phases: {
        Ready: {
          actions: {
            GO: noteHostAction({
              from: "host",
              payload: z.object({}),
              handler: (ctx) => ctx.transition("NB_Write"),
            }),
          },
        },
        ...mountRoundModule(noteModule, {
          prefix: "NB",
          slice: (state: NoteHostState) => state.slice,
          priv: (priv: NoteHostPriv) => priv.mod,
          params: { per: 3 },
          onDone: () => {}, // BAIL exits without finishing
        }),
        Scored: {},
      },
    });
    const table = new TestTable<NoteHostState, NoteHostPriv, NoteHostOptions>({
      definition,
      state: newNoteHostState(),
      options: {},
    });
    expect(table.start()).toBeUndefined();
    expect(table.act("p1", "GO")).toBeUndefined();
    expect(table.phase).toBe("NB_Write");
    table.tick(30); // the timeout at +30: into NB_Hold
    expect(table.phase).toBe("NB_Hold");
    expect(table.act("p1", "NB__BAIL")).toBeUndefined();
    expect(table.phase).toBe("Lobby");
  });
});

describe("replay", () => {
  it("replays a module session to the same state through replayLog", () => {
    const definition = defineGame<HostState, HostPriv, HostOptions>({
      name: "TapHost",
      version: "1",
      minPlayers: 1,
      maxPlayers: 4,
      startPhase: "Ready",
      createPrivateState: () => ({ mod: { drawn: "" }, hostNote: "h" }),
      phases: {
        Ready: {
          actions: {
            GO: hostAction({
              from: "host",
              payload: z.object({}),
              handler: (ctx) => ctx.transition("REPL_Tap"),
            }),
          },
        },
        ...mountRoundModule(tapModule, {
          prefix: "REPL",
          slice: (state: HostState) => state.slice,
          priv: (priv: HostPriv) => priv.mod,
          params: { limit: 3 },
          onDone: (ctx, result) => {
            ctx.state.total = result.total;
            ctx.transition("Scored");
          },
        }),
        Scored: {},
      },
      middleware: [actionLogMiddleware()],
    });
    const table = new TestTable<HostState, HostPriv, HostOptions>({
      definition,
      state: newHostState(),
      options: {},
    });
    expect(table.start()).toBeUndefined();
    expect(table.act("p1", "GO")).toBeUndefined();
    expect(table.act("p1", "REPL__TAP")).toBeUndefined();
    expect(table.act("p2", "REPL__TAP")).toBeUndefined();
    expect(table.act("p2", "REPL__TAP")).toBeUndefined(); // taps { p1: 1, p2: 2 }; nobody at the limit
    table.tick(1000); // Tap times out; Reveal draws twice from the room RNG.
    expect(table.phase).toBe("REPL_Reveal");
    table.tick(500); // Reveal times out: finish, onDone, Scored.
    expect(table.phase).toBe("Scored");

    const log = required(getActionLog(table.priv), "action log") as ActionLog;
    const { states } = replayLog(definition, log, {
      state: newHostState(),
      options: {},
      players: 4,
    });
    const final = required(states[states.length - 1], "final replayed state");
    expect(final.phase).toBe("Scored");
    expect(final.slice).toEqual(table.state.slice);
    expect(final.total).toBe(table.state.total);
  });
});
