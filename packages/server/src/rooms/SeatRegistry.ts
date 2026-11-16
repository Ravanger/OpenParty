import { createHash, timingSafeEqual } from "node:crypto";
import type { Client } from "@colyseus/core";

/** sha256 of a join secret; digests are compared with `timingSafeEqual`, so a wrong secret costs the same time as a right one. */
const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

/**
 * The room's seat and spectator tables: session-to-player bindings, per-seat join-secret digests,
 * kicked ids and secrets, and the spectator id table. Pure bookkeeping around Colyseus clients —
 * a client is only ever looked up through the getter the room passes in, never stored.
 */
export class SeatRegistry {
  /** The `playerId` each live session controls. */
  private readonly playerOf = new Map<string, string>();
  /** Server-only sha256 of each seated player's join secret; proves seat ownership on a later join and never leaves the room. */
  private readonly seatSecrets = new Map<string, Buffer>();
  private readonly spectators = new Set<string>();
  /** The join `playerId` of each spectator session: the key for audience dedup and per-scope votes. */
  private readonly spectatorIds = new Map<string, string>();
  private readonly kicked = new Set<string>();
  /** sha256 hex digest of each kicked player's seat secret; a fresh `playerId` with the same stored secret is refused too. */
  private readonly kickedSecretHashes = new Set<string>();

  constructor(private readonly clients: () => Iterable<Client>) {}

  /** The `playerId` bound to `sessionId`, if any. */
  playerIdFor(sessionId: string): string | undefined {
    return this.playerOf.get(sessionId);
  }

  /** The live session bound to `playerId`, if any (a player holds at most one binding). */
  sessionIdFor(playerId: string): string | undefined {
    for (const [sessionId, id] of this.playerOf) if (id === playerId) return sessionId;
    return undefined;
  }

  /** Rebinds `playerId` to `sessionId`; returns the client of the session it was bound to before, if any. */
  bind(playerId: string, sessionId: string): Client | undefined {
    let previous: Client | undefined;
    for (const [sid, id] of this.playerOf) {
      if (id === playerId) previous = this.findClient(sid);
    }
    this.unbind(playerId);
    this.playerOf.set(sessionId, playerId);
    return previous;
  }

  /** Unbinds every session bound to `playerId`. */
  unbind(playerId: string): void {
    for (const [sessionId, id] of this.playerOf)
      if (id === playerId) this.playerOf.delete(sessionId);
  }

  private findClient(sessionId: string): Client | undefined {
    for (const client of this.clients()) if (client.sessionId === sessionId) return client;
    return undefined;
  }

  /** The live client bound to `playerId`, if any. */
  clientFor(playerId: string): Client | undefined {
    const sessionId = this.sessionIdFor(playerId);
    if (sessionId === undefined) return undefined;
    return this.findClient(sessionId);
  }

  /** The spectator connection whose join `playerId` is `playerId`, if any. */
  spectatorClientFor(playerId: string): Client | undefined {
    for (const client of this.clients())
      if (this.spectatorIds.get(client.sessionId) === playerId) return client;
    return undefined;
  }

  /** Records a spectator session under its join `playerId`. */
  addSpectator(sessionId: string, playerId: string): void {
    this.spectators.add(sessionId);
    this.spectatorIds.set(sessionId, playerId);
  }

  /** Forgets a spectator session; true when it was one. */
  removeSpectator(sessionId: string): boolean {
    if (!this.spectators.delete(sessionId)) return false;
    this.spectatorIds.delete(sessionId);
    return true;
  }

  /** The join `playerId` of a spectator session, or `undefined` for seats and unknown sessions. */
  spectatorPlayerIdFor(sessionId: string): string | undefined {
    return this.spectatorIds.get(sessionId);
  }

  /** Refuses future joins from `playerId`. */
  markKicked(playerId: string): void {
    this.kicked.add(playerId);
  }

  /** True when `playerId` was kicked. */
  isKicked(playerId: string): boolean {
    return this.kicked.has(playerId);
  }

  /** True when `secret` was the stored secret of a kicked seat. */
  isKickedSecret(secret: string): boolean {
    return this.kickedSecretHashes.has(sha256(secret).toString("hex"));
  }

  /** Stores the sha256 digest of `playerId`'s join secret. */
  storeSecret(playerId: string, secret: string): void {
    this.seatSecrets.set(playerId, sha256(secret));
  }

  /** True when `secret` is exactly the stored secret of a seated player (constant-time compare). */
  secretMatches(playerId: string, secret: string): boolean {
    const stored = this.seatSecrets.get(playerId);
    return stored !== undefined && timingSafeEqual(stored, sha256(secret));
  }

  /** Forgets `playerId`'s seat secret; with `remember`, the digest also lands in the kicked-secret set. */
  forgetSecret(playerId: string, remember: boolean): void {
    const secret = this.seatSecrets.get(playerId);
    if (secret !== undefined && remember) this.kickedSecretHashes.add(secret.toString("hex"));
    this.seatSecrets.delete(playerId);
  }
}
