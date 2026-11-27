import { ClientMessage, isActionResult, LOBBY_PHASE, START_GAME } from "@openparty/shared";
import type { BaseGameState } from "@openparty/shared/schema";
import type {
  BotOptions,
  BotOutcome,
  BotRoom,
  BotSpeed,
  BotStrategy,
  BotTurn,
  DelayRange,
} from "./types.js";

const DEFAULT_THINK: DelayRange = [2000, 6000];
const DEFAULT_REACT: DelayRange = [500, 2500];

/** The skill a bot plays with when none is set. */
const DEFAULT_SKILL = 0.5;

/** Clamps `skill` to 0..1; a non-finite value falls back to {@link DEFAULT_SKILL}. */
const clampSkill = (skill: number): number =>
  Number.isFinite(skill) ? Math.min(1, Math.max(0, skill)) : DEFAULT_SKILL;

/**
 * The probability (0..1) that a bot at `skill` makes an error: `(1 - skill) / 2` — half of all
 * decisions at skill 0, none at skill 1. `skill` is clamped to 0..1 first, and a non-finite value
 * counts as the default 0.5. A strategy rolls its own random number against this probability.
 *
 * @experimental Reflex-round bot API; may change before 1.0.
 */
export const mistakeChance = (skill: number): number => (1 - clampSkill(skill)) / 2;

/** `ok` for an accepted action, with the raw answer as `detail`. */
export const outcomeOf = (bot: string, type: string, result: unknown): BotOutcome => ({
  bot,
  type,
  ok: isActionResult(result) && result.ok,
  detail: JSON.stringify(result),
});

/** One automatic player on a connected room, driven by a game's {@link BotStrategy}. */
export class BotPlayer<TState extends BaseGameState> {
  private readonly handled = new Set<string>();
  private readonly cancels = new Set<() => void>();
  private readonly rng: () => number;
  private readonly schedule: (run: () => void, ms: number) => () => void;
  private readonly skill: number;
  private phase = "";
  private starting = false;
  private left = false;

  constructor(
    readonly room: BotRoom<TState>,
    readonly playerId: string,
    readonly name: string,
    private readonly strategy: BotStrategy<TState>,
    private readonly options: BotOptions = {},
  ) {
    this.rng = options.rng ?? Math.random;
    this.schedule = options.schedule ?? ((run, ms) => this.timer(run, ms));
    this.skill = clampSkill(options.skill ?? DEFAULT_SKILL);
    room.onLeave(() => this.stop());
    room.onStateChange(() => this.react());
    this.react();
  }

  /** Stops the bot and leaves the room; safe to call more than once. */
  async leave(): Promise<void> {
    if (this.left) return;
    this.stop();
    await this.room.leave(true);
  }

  private stop(): void {
    this.left = true;
    this.cancelPending();
  }

  private react(): void {
    if (this.left) return;
    const state = this.room.state;
    if (state.phase !== this.phase) {
      this.phase = state.phase;
      this.handled.clear();
      this.cancelPending();
    }
    const turn = this.turn();
    if (this.options.host) {
      this.startWhenReady();
      this.strategy.host?.(turn);
    }
    this.strategy.play(turn);
  }

  private turn(): BotTurn<TState> {
    return {
      state: this.room.state,
      playerId: this.playerId,
      name: this.name,
      skill: this.skill,
      once: (key, run) => this.once(key, run),
      later: (delay, run) => this.later(delay, run),
      every: (ms, run) => this.every(ms, run),
      act: (type, payload = {}, note = type) => {
        void this.send(type, payload, note);
      },
      pick: (items) => items[Math.floor(this.rng() * items.length)],
    };
  }

  private startWhenReady(): void {
    const state = this.room.state;
    if (state.phase !== LOBBY_PHASE) {
      this.starting = false;
      return;
    }
    const named = [...state.players.values()].filter((seat) => seat.name !== "").length;
    if (!state.canStart || this.starting || named < (this.options.host?.expectedPlayers ?? 0))
      return;
    this.starting = true;
    void this.send(START_GAME, {}, START_GAME).then((ok) => {
      if (!ok) this.starting = false;
    });
  }

  private async send(type: string, payload: object, note: string): Promise<boolean> {
    const outcome = await this.room.request(ClientMessage.ACTION, { ...payload, type }).then(
      (result) => {
        this.options.log?.(`${this.name} ${note} -> ${JSON.stringify(result)}`);
        return outcomeOf(this.name, type, result);
      },
      (error: unknown) => {
        this.options.log?.(`${this.name} ${type} failed: ${String(error)}`);
        return { bot: this.name, type, ok: false, detail: String(error) };
      },
    );
    this.options.onOutcome?.(outcome);
    return outcome.ok;
  }

  private once(key: string, run: () => void): void {
    if (this.handled.has(key)) return;
    this.handled.add(key);
    run();
  }

  private later(delay: BotSpeed | DelayRange, run: () => void): void {
    const [min, max] = this.range(delay);
    // `cancel` is assigned only after schedule() returns, but a scheduler may invoke the callback
    // synchronously inside that call; read it through a guarded closure so it is never in its TDZ.
    let cancel: (() => void) | undefined;
    let fired = false;
    const forget = (): void => {
      if (cancel !== undefined) this.cancels.delete(cancel);
    };
    cancel = this.schedule(
      () => {
        fired = true;
        forget();
        run();
      },
      min + this.rng() * (max - min),
    );
    // A scheduler that already ran the callback consumed it: do not track a stale handle.
    if (!fired) this.cancels.add(cancel);
  }

  private range(delay: BotSpeed | DelayRange): DelayRange {
    if (delay === "think") return this.scaled(this.options.thinkMs ?? DEFAULT_THINK);
    if (delay === "react") return this.scaled(this.options.reactMs ?? DEFAULT_REACT);
    return delay;
  }

  /** Shrinks a range by the skill factor `1.5 - skill`: 1.5× at skill 0, 1× at the default 0.5, 0.5× at skill 1. */
  private scaled([min, max]: DelayRange): DelayRange {
    const factor = 1.5 - this.skill;
    return [min * factor, max * factor];
  }

  private every(ms: number, run: () => void): void {
    let cancel: (() => void) | undefined;
    const stop = (): void => {
      if (cancel !== undefined) this.cancels.delete(cancel);
    };
    // Marks a synchronously-fired callback: a scheduler can invoke the callback inside the
    // schedule() call, and the handle it returns is stale for a reschedule that already ran.
    let synchronous = false;
    let reentrant = false;
    const scheduleOnce = (runOnce: () => void): void => {
      synchronous = false;
      cancel = this.schedule(() => {
        synchronous = true;
        runOnce();
      }, ms);
      // A scheduler that already ran the callback consumed it: do not track a stale handle.
      if (!synchronous) this.cancels.add(cancel);
    };
    const tick = (): void => {
      // A synchronously-fired reschedule would recurse on this stack; end the cadence.
      if (reentrant) return;
      reentrant = true;
      try {
        stop();
        const phase = this.phase;
        try {
          run();
        } catch (error) {
          this.options.log?.(`${this.name} every callback failed: ${String(error)}`);
          return;
        }
        // A phase change or leave during `run` already cleared the pending cadences.
        if (this.left || this.phase !== phase) return;
        scheduleOnce(tick);
      } finally {
        reentrant = false;
      }
    };
    scheduleOnce(tick);
  }

  private cancelPending(): void {
    for (const cancel of this.cancels) cancel();
    this.cancels.clear();
  }

  private timer(run: () => void, ms: number): () => void {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  }
}
