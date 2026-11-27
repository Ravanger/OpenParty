import { required, shuffle } from "../utils.js";

/**
 * Partitions `ids` into teams of the given sizes, drawn with `rng`. Sizes must be positive
 * integers summing to the number of ids. `history` holds ids that have already held a single-seat
 * team, oldest first: pass the sole member of each earlier assignment to rotate that seat — ids
 * never soloed come first, then the least recently soloed ones. Inputs are never mutated.
 *
 * @experimental Phase kit API; may change before 1.0.
 * @throws {Error} when a size is not a positive integer or the sizes do not sum to `ids.length`.
 */
export function assignTeams(
  ids: readonly string[],
  shape: readonly number[],
  rng: () => number,
  history: Iterable<string> = [],
): string[][] {
  if (shape.some((size) => !Number.isInteger(size) || size <= 0)) {
    throw new Error(`Team shape ${JSON.stringify(shape)} needs positive integer sizes`);
  }
  const needed = shape.reduce((sum, size) => sum + size, 0);
  if (needed !== ids.length) {
    throw new Error(`Team shape ${JSON.stringify(shape)} needs ${needed} ids, got ${ids.length}`);
  }

  const shuffled = shuffle(ids, rng);
  const lastSoloAt = new Map<string, number>();
  let index = 0;
  for (const id of history) {
    lastSoloAt.set(id, index);
    ++index;
  }

  const soloIds = [...shuffled]
    .sort((a, b) => (lastSoloAt.get(a) ?? -1) - (lastSoloAt.get(b) ?? -1))
    .slice(0, shape.filter((size) => size === 1).length);
  const soloed = new Set(soloIds);
  const rest = shuffled.filter((id) => !soloed.has(id));

  const teams: string[][] = [];
  let cursor = 0;
  for (const size of shape) {
    if (size === 1) {
      teams.push([required(soloIds.shift(), "solo team id")]);
      continue;
    }
    teams.push(rest.slice(cursor, cursor + size));
    cursor += size;
  }
  return teams;
}

/**
 * One total per team: the sum of its members' scores, keyed by playerId; an id with no score counts
 * as zero. Neither input is mutated.
 *
 * @experimental Phase kit API; may change before 1.0.
 */
export function teamTotals(
  scores: Readonly<Record<string, number>>,
  teams: Iterable<Iterable<string>>,
): number[] {
  return [...teams].map((team) => {
    let total = 0;
    for (const id of team) total += scores[id] ?? 0;
    return total;
  });
}
