import { required, shuffle } from "../utils.js";

/**
 * A reproducible turn order: the ids in a fresh array, shuffled with `rng`.
 *
 * @experimental Phase kit API; may change before 1.0.
 */
export function createTurnOrder(ids: readonly string[], rng: () => number): string[] {
  return shuffle(ids, rng);
}

/**
 * The next id in `order` after `current` that is in `presentIds`, wrapping around; `undefined`
 * when none of the order is present. A `current` outside the order starts from its first id.
 *
 * @experimental Phase kit API; may change before 1.0.
 */
export function nextTurn(
  order: readonly string[],
  current: string | undefined,
  presentIds: ReadonlySet<string>,
): string | undefined {
  if (order.length === 0 || presentIds.size === 0) return undefined;
  const at = current === undefined ? -1 : order.indexOf(current);
  for (let offset = 1; offset <= order.length; ++offset) {
    const id = required(order[(at + offset) % order.length], "turn order id");
    if (presentIds.has(id)) return id;
  }
  return undefined;
}
