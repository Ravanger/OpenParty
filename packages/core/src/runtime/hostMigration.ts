import { required } from "../utils.js";
import type { HostMigration, HostPicker, PlayerInfo } from "./types.js";

/**
 * Picks the next host for a room whose current host is no longer connected: filters `players`
 * (every seat, in seat order) to the connected ones and applies `policy` — a named policy or a
 * {@link HostPicker} that picks among those connected seats. Returns `undefined`, keeping the
 * current host in place, when no seat is connected, when the policy declines (`"none"`, or a
 * picker returning `undefined`), or when a picker returns an id outside the connected seats
 * (stale, disconnected or never seated). Pure: it draws from `rng` only through the policy, so
 * a replay can reproduce the same choice — and calls no host at all.
 */
export function pickNextHost(
  policy: HostMigration,
  players: PlayerInfo[],
  rng: () => number,
): string | undefined {
  const candidates = players.filter((p) => p.isConnected);
  if (candidates.length === 0) return undefined;
  const nextId =
    typeof policy === "function" ? policy(candidates, rng) : pickNamed(policy, candidates, rng);
  if (nextId === undefined || !candidates.some((p) => p.id === nextId)) return undefined;
  return nextId;
}

/** The named `hostMigration` policies: pick from the connected seats in seat order. */
function pickNamed(
  policy: Exclude<HostMigration, HostPicker>,
  candidates: PlayerInfo[],
  rng: () => number,
): string | undefined {
  switch (policy) {
    case "none":
      return undefined;
    case "oldest":
      return required(candidates[0], "host candidate").id;
    case "random":
      return required(candidates[Math.floor(rng() * candidates.length)], "host candidate").id;
    case "next-seated":
      return (
        candidates.find((c) => c.isActive && c.isReady)?.id ??
        candidates.find((c) => c.isReady)?.id ??
        required(candidates[0], "host candidate").id
      );
  }
}
