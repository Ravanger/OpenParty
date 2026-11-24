import { BaseGameState } from "@openparty/shared/schema";
import { describe, expect, it } from "vitest";
import { BotPlayer } from "../src/BotPlayer.js";
import { composeStrategies } from "../src/composeStrategies.js";
import type { BotRoom, BotStrategy, BotTurn } from "../src/types.js";

type State = BaseGameState;

const stubTurn = (phase: string): BotTurn<State> => {
  const state = new BaseGameState();
  state.phase = phase;
  return {
    state,
    playerId: "bot-0000001",
    name: "Bot 1",
    once: () => undefined,
    later: () => undefined,
    act: () => undefined,
    pick: () => undefined,
  };
};

const recording = (name: string, log: string[], host = false): BotStrategy<State> => ({
  play: (turn) => log.push(`${name}.play:${turn.state.phase}`),
  ...(host
    ? {
        host: (turn: BotTurn<State>) => {
          log.push(`${name}.host:${turn.state.phase}`);
        },
      }
    : {}),
});

class StubRoom implements BotRoom<State> {
  readonly state = new BaseGameState();
  readonly sent: object[] = [];
  private readonly listeners: Array<() => void> = [];

  onStateChange(callback: () => void): void {
    this.listeners.push(callback);
  }

  onLeave(_callback: () => void): void {
    // No bot leaves in this test.
  }

  request(_type: string, payload: object): Promise<unknown> {
    this.sent.push(payload);
    return Promise.resolve({ ok: true });
  }

  async leave(): Promise<void> {
    // No bot leaves in this test.
  }

  changed(): void {
    for (const listener of this.listeners) listener();
  }
}

describe("composeStrategies", () => {
  it("dispatches play to the strategy of the matching module prefix", () => {
    const log: string[] = [];
    const composed = composeStrategies(recording("base", log), { MOD: recording("mod", log) });
    composed.play(stubTurn("MOD_Tap"));
    expect(log).toEqual(["mod.play:MOD_Tap"]);
  });

  it("falls back to the base strategy outside a module phase", () => {
    const log: string[] = [];
    const composed = composeStrategies(recording("base", log), { MOD: recording("mod", log) });
    composed.play(stubTurn("Lobby"));
    composed.play(stubTurn("Round"));
    expect(log).toEqual(["base.play:Lobby", "base.play:Round"]);
  });

  it("runs both host hooks in a module phase, base first", () => {
    const log: string[] = [];
    const composed = composeStrategies(recording("base", log, true), {
      MOD: recording("mod", log, true),
    });
    composed.host?.(stubTurn("MOD_Tap"));
    expect(log).toEqual(["base.host:MOD_Tap", "mod.host:MOD_Tap"]);
  });

  it("runs only the base host hook outside a module phase or without a module host", () => {
    const log: string[] = [];
    const composed = composeStrategies(recording("base", log, true), {
      MOD: recording("mod", log),
    });
    composed.host?.(stubTurn("Lobby"));
    composed.host?.(stubTurn("MOD_Tap"));
    expect(log).toEqual(["base.host:Lobby", "base.host:MOD_Tap"]);
  });

  it("is silent when neither strategy has a host hook", () => {
    const log: string[] = [];
    const composed = composeStrategies(recording("base", log), { MOD: recording("mod", log) });
    composed.host?.(stubTurn("MOD_Tap"));
    expect(log).toEqual([]);
  });

  it("prefers the longest matching prefix", () => {
    const log: string[] = [];
    const composed = composeStrategies(recording("base", log), {
      A_B: recording("long", log),
      A: recording("short", log),
    });
    composed.play(stubTurn("A_B_Tap"));
    composed.play(stubTurn("A_X"));
    expect(log).toEqual(["long.play:A_B_Tap", "short.play:A_X"]);
  });

  it("drives a bot with the module strategy in a module phase and the base elsewhere", async () => {
    const room = new StubRoom();
    room.state.phase = "Round";
    const composed = composeStrategies<State>(
      { play: (turn) => turn.act("BASE_PRESS") },
      { MOD: { play: (turn) => turn.act("MOD__TAP") } },
    );
    new BotPlayer(room, "bot-0000001", "Bot 1", composed);
    room.state.phase = "MOD_Tap";
    room.changed();
    room.state.phase = "Round";
    room.changed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(room.sent).toEqual([
      { type: "BASE_PRESS" },
      { type: "MOD__TAP" },
      { type: "BASE_PRESS" },
    ]);
  });
});
