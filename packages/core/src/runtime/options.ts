import { MAX_OPTIONS_JSON_LENGTH } from "@openparty/shared";
import type { GameDefinition, PhaseState } from "./types.js";

/** Why {@link resolveGameOptions} refused a set of raw room options. */
export type OptionsRejectionReason = "unexpected" | "invalid" | "too-large";

/** The outcome of resolving raw room options; Zod error text never reaches it (rule 17). */
export type ResolvedGameOptions<TOptions> =
  | { ok: true; options: TOptions }
  | { ok: false; reason: OptionsRejectionReason };

/**
 * Turns raw room options into the game's parsed options, applying the one options contract: a game
 * without an `options` schema accepts no keys (`"unexpected"`), a schema failure is `"invalid"`,
 * and a parse result whose JSON exceeds {@link MAX_OPTIONS_JSON_LENGTH} is `"too-large"`. Pure: it
 * never logs or throws, and Zod error text never reaches the result.
 */
export function resolveGameOptions<TOptions>(
  definition: Pick<GameDefinition<PhaseState, unknown, TOptions>, "options">,
  raw: Record<string, unknown>,
): ResolvedGameOptions<TOptions> {
  const schema = definition.options;
  if (!schema) {
    return Object.keys(raw).length === 0
      ? { ok: true, options: raw as TOptions }
      : { ok: false, reason: "unexpected" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (JSON.stringify(parsed.data).length > MAX_OPTIONS_JSON_LENGTH) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, options: parsed.data };
}
