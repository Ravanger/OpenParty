import type { Client } from "@colyseus/core";
import { describe, expect, it } from "vitest";
import { SeatRegistry } from "../src/rooms/SeatRegistry.js";

/** A minimal fake client: the registry only ever reads `sessionId`. */
const fakeClient = (sessionId: string): Client => ({ sessionId }) as Client;

const registryOf = (...clients: Client[]): SeatRegistry => new SeatRegistry(() => clients);

describe("SeatRegistry", () => {
  it("bind returns the previous session's client and unbinds it", () => {
    const a = fakeClient("session-a");
    const b = fakeClient("session-b");
    const c = fakeClient("session-c");
    const registry = registryOf(a, b, c);
    expect(registry.bind("p1", "session-a")).toBeUndefined();
    expect(registry.playerIdFor("session-a")).toBe("p1");
    expect(registry.bind("p1", "session-b")).toBe(a);
    expect(registry.playerIdFor("session-a")).toBeUndefined();
    expect(registry.playerIdFor("session-b")).toBe("p1");
    // binding another player leaves p1's binding untouched
    registry.bind("p2", "session-c");
    expect(registry.playerIdFor("session-b")).toBe("p1");
    expect(registry.playerIdFor("session-c")).toBe("p2");
  });

  it("unbind removes the bindings of one player only", () => {
    const registry = registryOf();
    registry.bind("p1", "session-a");
    registry.bind("p2", "session-b");
    registry.unbind("p1");
    expect(registry.playerIdFor("session-a")).toBeUndefined();
    expect(registry.playerIdFor("session-b")).toBe("p2");
    // unbinding an unknown player is a no-op
    registry.unbind("nobody");
    expect(registry.playerIdFor("session-b")).toBe("p2");
  });

  it("a seat secret matches only its own secret", () => {
    const registry = registryOf();
    expect(registry.secretMatches("p1", "s3cret")).toBe(false); // nothing stored yet
    registry.storeSecret("p1", "s3cret");
    expect(registry.secretMatches("p1", "s3cret")).toBe(true);
    expect(registry.secretMatches("p1", "other")).toBe(false);
    registry.storeSecret("p2", "other");
    expect(registry.secretMatches("p2", "s3cret")).toBe(false); // stored for another seat
  });

  it("refuses a kicked id and a kicked secret", () => {
    const registry = registryOf();
    registry.markKicked("p1");
    expect(registry.isKicked("p1")).toBe(true);
    expect(registry.isKicked("p2")).toBe(false);
    registry.storeSecret("p1", "s3cret");
    registry.forgetSecret("p1", true);
    expect(registry.isKickedSecret("s3cret")).toBe(true);
    expect(registry.isKickedSecret("other")).toBe(false);
  });

  it("dropping a seat forgets its secret without remembering it", () => {
    const registry = registryOf();
    registry.storeSecret("p1", "s3cret");
    registry.forgetSecret("p1", false);
    expect(registry.secretMatches("p1", "s3cret")).toBe(false);
    expect(registry.isKickedSecret("s3cret")).toBe(false);
    // forgetting a seat that stores no secret is a no-op
    registry.forgetSecret("nobody", true);
    expect(registry.isKickedSecret("s3cret")).toBe(false);
  });

  it("resolves clients by seat and by spectator id", () => {
    const a = fakeClient("session-a");
    const b = fakeClient("session-b");
    const registry = registryOf(a, b);
    expect(registry.clientFor("p1")).toBeUndefined();
    registry.bind("p1", "session-a");
    expect(registry.clientFor("p1")).toBe(a);
    // a binding whose session is not among the live clients resolves to nothing
    const lonely = registryOf();
    lonely.bind("p9", "session-x");
    expect(lonely.clientFor("p9")).toBeUndefined();
    registry.addSpectator("session-b", "p2");
    expect(registry.spectatorClientFor("p2")).toBe(b);
    expect(registry.spectatorClientFor("p3")).toBeUndefined();
    expect(registry.spectatorPlayerIdFor("session-b")).toBe("p2");
    expect(registry.spectatorPlayerIdFor("session-a")).toBeUndefined();
  });

  it("tracks spectators per session", () => {
    const registry = registryOf();
    registry.addSpectator("session-a", "p1");
    expect(registry.removeSpectator("session-a")).toBe(true);
    expect(registry.spectatorPlayerIdFor("session-a")).toBeUndefined();
    expect(registry.removeSpectator("session-a")).toBe(false);
  });

  it("resolves the live session of a seated player", () => {
    const registry = registryOf(fakeClient("session-a"));
    expect(registry.sessionIdFor("p1")).toBeUndefined();
    registry.bind("p1", "session-a");
    expect(registry.sessionIdFor("p1")).toBe("session-a");
  });
});
