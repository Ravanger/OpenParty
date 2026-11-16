import type { Seed } from "../utils.js";
import type { Logger } from "./logger.js";
import type { PlayerInfo } from "./types.js";

declare const timerTag: unique symbol;
/**
 * Opaque handle for a timer created by {@link RuntimeHost.setTimeout}. A tagged
 * number: hosts tag their numeric id with a single `as`, and a plain number is
 * still a type error, so no double assertion is needed at any boundary.
 */
export type TimerHandle = number & { readonly [timerTag]: true };

/** Everything the runtime needs from its environment. Implemented by the server; faked in tests. */
export interface RuntimeHost {
  /** Every seat in the room. */
  players(): PlayerInfo[];
  /** Mark every ready seat active. */
  activateWaitingPlayers(): void;
  /** Mark every unready seat inactive; called when the game leaves the Lobby. */
  benchUnreadyPlayers(): void;
  /** Sends one message to one player. */
  send(playerId: string, type: string, payload: unknown): void;
  /** Sends one message to every client. */
  broadcast(type: string, payload: unknown): void;
  /** Called once per applied phase transition, after the `transition` middleware event; hosts record replay snapshots here and clear every {@link RuntimeHost.audienceOnce} scope. */
  notifyTransition(from: string, to: string): void;
  /**
   * True the first time `audienceKey` votes in `scope`, false afterwards; hosts clear every scope
   * when the phase changes (see {@link RuntimeHost.notifyTransition}). Backs `ctx.audience.once`
   * for audience actions. In-memory only — audience identity is never persisted.
   */
  audienceOnce(audienceKey: string, scope: string): boolean;
  /** Makes a `.view()`-tagged part of the state visible to `playerId`. */
  showTo(playerId: string, ref: object): void;
  /** Hides a part previously shown with `showTo` from `playerId`. */
  hideFrom(playerId: string, ref: object): void;
  /** Remove the seat and tell the player they were kicked. */
  kick(playerId: string): void;
  /** Make `playerId` the host and demote the current one; the runtime's host migration calls it (#36). Hosts that omit it (replay) never migrate. */
  setHost?(playerId: string): void;
  /** Make the (validated) room options visible to clients. */
  publishOptions(options: unknown): void;
  /** Sinks the room's log lines; when omitted the runtime uses {@link noopLogger}. */
  log?: Logger;
  /** The current time in epoch milliseconds. */
  now(): number;
  /** A random number in [0, 1) drawn from the room seed. */
  rng(): number;
  /** The room RNG seed (see `sfc32`); recorded in the action log header. */
  readonly seed: Seed;
  /** Runs `callback` once after `ms` milliseconds and returns a handle for `clearTimeout`. */
  setTimeout(callback: () => void, ms: number): TimerHandle;
  /** Cancels a timer made with `setTimeout`; a fired or unknown handle is ignored. */
  clearTimeout(handle: TimerHandle): void;
}
