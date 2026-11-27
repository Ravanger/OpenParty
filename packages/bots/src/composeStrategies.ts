import type { BaseGameState } from "@openparty/shared/schema";
import type { BotStrategy, BotTurn } from "./types.js";

/**
 * Composes a base bot strategy with one strategy per mounted round module. In a `<prefix>_<Phase>`
 * phase the strategy mounted under `prefix` plays; every other phase falls through to `base` (the
 * longest matching prefix wins). The `host` hooks of the base and of the matching module both run —
 * base first — and a strategy without one is skipped.
 *
 * @experimental Round module API; may change before 1.0.
 */
export function composeStrategies<TState extends BaseGameState>(
  base: BotStrategy<TState>,
  modules: Record<string, BotStrategy<TState>>,
): BotStrategy<TState> {
  const prefixes = Object.keys(modules);
  const match = (phase: string): BotStrategy<TState> | undefined => {
    let best: string | undefined;
    for (const prefix of prefixes) {
      if (!phase.startsWith(`${prefix}_`)) continue;
      if (best === undefined || prefix.length > best.length) best = prefix;
    }
    return best === undefined ? undefined : modules[best];
  };
  return {
    play: (turn: BotTurn<TState>) => {
      const mod = match(turn.state.phase);
      if (mod === undefined) base.play(turn);
      else mod.play(turn);
    },
    host: (turn: BotTurn<TState>) => {
      base.host?.(turn);
      match(turn.state.phase)?.host?.(turn);
    },
  };
}
