import {
  CLIENT_MESSAGES,
  END_GAME,
  ErrorCode,
  LOBBY_PHASE,
  PAUSE_GAME,
  RESUME_GAME,
  START_GAME,
} from "@openparty/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type ActionLog,
  actionFactory,
  actionLogMiddleware,
  defineGame,
  type GameDefinition,
  getActionLog,
  MAX_PAUSE_MS,
  type PhaseState,
} from "../../src/index.js";
import { replayLog } from "../../src/testing/index.js";
import { TestTable } from "../../src/testing/TestTable.js";

interface PauseState extends PhaseState {
  taps: number;
  cheers: number;
  ticks: number;
}

type PausePriv = Record<string, never>;
type PauseOptions = Record<string, never>;
type PauseSpec = GameDefinition<PauseState, PausePriv, PauseOptions>;

const action = actionFactory<PauseState, PausePriv, PauseOptions>();
const empty = z.object({});

/** A timed, ticking game whose player and audience actions touch state. */
function makeDefinition(): PauseSpec {
  return defineGame<PauseState, PausePriv, PauseOptions>({
    name: "Pausable",
    version: "1",
    minPlayers: 1,
    maxPlayers: 4,
    startPhase: "Play",
    createPrivateState: () => ({}),
    phases: {
      Play: {
        duration: 1050,
        tickMs: 100,
        onTick: (ctx) => {
          ctx.state.ticks += 1;
        },
        onTimeout: (ctx) => ctx.transition("Done"),
        actions: {
          TAP: action({
            from: "player",
            payload: empty,
            handler: (ctx) => {
              ctx.state.taps += 1;
            },
          }),
          CHEER: action({
            from: "audience",
            payload: empty,
            handler: (ctx) => {
              ctx.state.cheers += 1;
            },
          }),
          QUIT: action({
            from: "host",
            payload: empty,
            handler: (ctx) => ctx.transition("Done"),
          }),
        },
      },
      Done: {},
    },
  });
}

const newState = (): PauseState => ({
  phase: "",
  phaseEndsAt: 0,
  phaseDurationMs: 0,
  canStart: false,
  taps: 0,
  cheers: 0,
  ticks: 0,
});

const table = (
  definition: PauseSpec = makeDefinition(),
): TestTable<PauseState, PausePriv, PauseOptions> =>
  new TestTable({ definition, state: newState(), options: {}, players: 2 });

describe("host pause", () => {
  it("freezes the phase timer and shifts phaseEndsAt by exactly the paused time", () => {
    const t = table();
    t.start();
    const ends = t.state.phaseEndsAt;
    t.tick(400);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.state.pausedAt).toBe(t.host.now());
    // A long pause: the phase never times out and phaseEndsAt stays put.
    t.tick(5000);
    expect(t.phase).toBe("Play");
    expect(t.state.phaseEndsAt).toBe(ends);
    expect(t.act("p1", RESUME_GAME)).toBeUndefined();
    expect(t.state.pausedAt).toBe(0);
    expect(t.state.phaseEndsAt).toBe(ends + 5000);
    // The 650 ms left at the pause are still 650 ms from the resume.
    t.tick(649);
    expect(t.phase).toBe("Play");
    t.tick(1);
    expect(t.phase).toBe("Done");
  });

  it("stops ticks while paused and continues the same cadence from the resume", () => {
    const t = table();
    t.start();
    t.tick(250);
    expect(t.state.ticks).toBe(2);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    t.tick(1000);
    expect(t.state.ticks).toBe(2);
    expect(t.act("p1", RESUME_GAME)).toBeUndefined();
    // The next tick was 50 ms away when the pause began, not a full interval.
    t.tick(49);
    expect(t.state.ticks).toBe(2);
    t.tick(1);
    expect(t.state.ticks).toBe(3);
    t.tick(100);
    expect(t.state.ticks).toBe(4);
  });

  it("pauses and resumes a phase without a timer or ticks", () => {
    const t = table();
    t.start();
    expect(t.act("p1", "QUIT")).toBeUndefined();
    expect(t.phase).toBe("Done");
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.state.pausedAt).toBe(t.host.now());
    expect(t.act("p1", RESUME_GAME)).toBeUndefined();
    expect(t.state.pausedAt).toBe(0);
    expect(t.state.phaseEndsAt).toBe(0);
    expect(t.host.pendingTimers).toBe(0);
  });

  it("allows only the host to pause and resume", () => {
    const t = table();
    t.start();
    expect(t.act("p2", PAUSE_GAME)).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    expect(t.state.pausedAt).toBe(0);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.act("p2", RESUME_GAME)).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    expect(t.state.pausedAt).toBe(t.host.now());
  });

  it("refuses pause and resume in the Lobby", () => {
    const t = table();
    expect(t.act("p1", PAUSE_GAME)).toMatchObject({ code: ErrorCode.WRONG_PHASE });
    expect(t.act("p1", RESUME_GAME)).toMatchObject({ code: ErrorCode.WRONG_PHASE });
    expect(t.state.pausedAt).toBe(0);
    expect(t.phase).toBe(LOBBY_PHASE);
  });

  it("treats a second pause as a no-op and a resume while running as a no-op", () => {
    const t = table();
    t.start();
    const ends = t.state.phaseEndsAt;
    t.tick(100);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    const pausedAt = t.state.pausedAt;
    t.tick(200);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.state.pausedAt).toBe(pausedAt);
    t.tick(300);
    expect(t.act("p1", RESUME_GAME)).toBeUndefined();
    expect(t.state.phaseEndsAt).toBe(ends + 500);
    // Already running: a second resume changes nothing.
    expect(t.act("p1", RESUME_GAME)).toBeUndefined();
    expect(t.state.pausedAt).toBe(0);
    expect(t.state.phaseEndsAt).toBe(ends + 500);
  });

  it("ends the game while paused and leaves the room running for the next one", () => {
    const t = table();
    t.start();
    t.tick(200);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.act("p1", END_GAME)).toBeUndefined();
    expect(t.phase).toBe(LOBBY_PHASE);
    expect(t.state.pausedAt).toBe(0);
    t.tick(5000);
    expect(t.phase).toBe(LOBBY_PHASE);
    expect(t.act("p1", START_GAME)).toBeUndefined();
    expect(t.phase).toBe("Play");
    t.tick(100);
    expect(t.state.ticks).toBe(3);
  });

  it("refuses an undeclared action with GAME_PAUSED, not UNKNOWN_ACTION, while paused", () => {
    // The pause check runs before the action lookup, so an action that does not exist anywhere
    // is answered GAME_PAUSED while the room is paused.
    const t = table();
    t.start();
    t.tick(100);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.act("p2", "NOT_A_REAL_ACTION")).toEqual({
      code: ErrorCode.GAME_PAUSED,
      message: CLIENT_MESSAGES.GAME_PAUSED,
    });
  });

  it("rejects player, audience and built-in actions with GAME_PAUSED, but not END_GAME", () => {
    const t = table();
    t.start();
    t.tick(100);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.act("p2", "TAP")).toEqual({
      code: ErrorCode.GAME_PAUSED,
      message: CLIENT_MESSAGES.GAME_PAUSED,
    });
    expect(t.act("p1", "KICK_PLAYER", { playerId: "p2" })).toMatchObject({
      code: ErrorCode.GAME_PAUSED,
    });
    expect(t.runtime.dispatchAudience("tv-1", { type: "CHEER" })).toMatchObject({
      code: ErrorCode.GAME_PAUSED,
    });
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    expect(t.state.taps).toBe(0);
    expect(t.state.cheers).toBe(0);
    expect(t.host.seats).toHaveLength(2);
    expect(t.act("p1", END_GAME)).toBeUndefined();
    expect(t.phase).toBe(LOBBY_PHASE);
  });

  it("ends the game to the Lobby when a pause outlasts the fixed maximum", () => {
    const t = table();
    t.start();
    t.tick(100);
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    t.tick(MAX_PAUSE_MS - 1);
    expect(t.phase).toBe("Play");
    t.tick(1);
    expect(t.phase).toBe(LOBBY_PHASE);
    expect(t.state.pausedAt).toBe(0);
    expect(t.state.notice).toBe("The game ended because it was paused for too long.");
    expect(t.host.pendingTimers).toBe(0);
  });

  it("clears the pause timer on stop", () => {
    const t = table();
    t.start();
    expect(t.act("p1", PAUSE_GAME)).toBeUndefined();
    t.runtime.stop();
    expect(t.host.pendingTimers).toBe(0);
    t.tick(MAX_PAUSE_MS);
    expect(t.phase).toBe("Play");
  });
});

describe("pause in the action log and replay", () => {
  it("records pause and resume and replays a paused session to the same state", () => {
    const definition = makeDefinition();
    const live = table({ ...definition, middleware: [actionLogMiddleware()] });
    live.start();
    live.tick(300); // ticks at 100, 200, 300
    expect(live.act("p2", "TAP")).toBeUndefined();
    expect(live.act("p1", PAUSE_GAME)).toBeUndefined();
    live.tick(7000);
    expect(live.act("p1", RESUME_GAME)).toBeUndefined();
    live.tick(800); // 7 ticks from the resume, then the timeout at +1050 of active time
    expect(live.phase).toBe("Done");
    expect(live.state.ticks).toBe(10);
    const log = getActionLog(live.priv) as ActionLog;
    expect(log.entries.map((entry) => entry.actionType).filter(Boolean)).toEqual([
      START_GAME,
      "TAP",
      PAUSE_GAME,
      RESUME_GAME,
    ]);
    const { states } = replayLog(definition, log, {
      state: newState(),
      options: {},
      players: 2,
    });
    expect(states[states.length - 1]).toMatchObject({
      phase: "Done",
      taps: 1,
      cheers: 0,
      ticks: 10,
      pausedAt: 0,
    });
  });
});
