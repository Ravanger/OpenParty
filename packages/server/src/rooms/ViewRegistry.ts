import type { Client } from "@colyseus/core";
import { type Schema, StateView } from "@colyseus/schema";

/**
 * The room's per-session views and the private refs each player is shown. `show` remembers a ref
 * even when the player has no live view yet (the drop window), and `restore` replays the remembered
 * refs on reconnection. A client is only ever used as a method argument, never stored.
 */
export class ViewRegistry {
  private readonly views = new Map<string, StateView>();
  private readonly viewRefs = new Map<string, Set<Schema>>();

  /** Resolves a seated player's live session; the room delegates this to its `SeatRegistry`. */
  constructor(private readonly sessionFor: (playerId: string) => string | undefined) {}

  /** Creates the per-session view and attaches it to the client. */
  open(client: Client): void {
    const view = new StateView();
    client.view = view;
    this.views.set(client.sessionId, view);
  }

  /** Closes the view of `sessionId`, if any. */
  close(sessionId: string): void {
    this.views.delete(sessionId);
  }

  /** Shows `ref` to `playerId`: remembered for restore and added to the live view when one is open. */
  show(playerId: string, ref: Schema): void {
    const refs = this.viewRefs.get(playerId) ?? new Set<Schema>();
    this.viewRefs.set(playerId, refs.add(ref));
    const sessionId = this.sessionFor(playerId);
    if (sessionId === undefined) return;
    this.views.get(sessionId)?.add(ref);
  }

  /** Hides `ref` from `playerId`: removed from the remembered set and from the live view. */
  hide(playerId: string, ref: Schema): void {
    this.viewRefs.get(playerId)?.delete(ref);
    const sessionId = this.sessionFor(playerId);
    if (sessionId === undefined) return;
    this.views.get(sessionId)?.remove(ref);
  }

  /** Replays every remembered ref of `playerId` onto the client's open view, if any. */
  restore(playerId: string, client: Client): void {
    const view = this.views.get(client.sessionId);
    for (const ref of this.viewRefs.get(playerId) ?? []) view?.add(ref);
  }

  /** Forgets the remembered refs of a dropped seat. */
  forget(playerId: string): void {
    this.viewRefs.delete(playerId);
  }
}
