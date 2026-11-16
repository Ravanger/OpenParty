import type { Client } from "@colyseus/core";
import { Encoder, StateView } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import { ViewRegistry } from "../src/rooms/ViewRegistry.js";
import { BuzzerState, SecretSchema } from "./fixtures/buzzer.js";

/** A minimal fake client: the registry only ever reads `sessionId` and writes `view`. */
const fakeClient = (sessionId: string): Client => ({ sessionId }) as Client;

/** A state with an encoder attached: a view can only add refs of a state owned by a root. */
const liveState = (): BuzzerState => {
  const state = new BuzzerState();
  new Encoder(state);
  return state;
};

/** A view can only add refs attached to a state, so every test ref lives in one. */
const secretOf = (state: BuzzerState, key: string) => {
  const s = new SecretSchema();
  state.secrets.set(key, s);
  return s;
};

describe("ViewRegistry", () => {
  it("open attaches a fresh view to the client", () => {
    const registry = new ViewRegistry(() => "s1");
    const client = fakeClient("s1");
    registry.open(client);
    expect(client.view).toBeInstanceOf(StateView);
  });

  it("replays a show made before the player has a view on restore", () => {
    let session: string | undefined;
    const registry = new ViewRegistry(() => session);
    const ref = secretOf(liveState(), "p1");
    registry.show("p1", ref); // no live session yet: remembered only
    const client = fakeClient("s1");
    session = "s1";
    registry.open(client);
    expect(client.view?.has(ref)).toBe(false);
    registry.restore("p1", client);
    expect(client.view?.has(ref)).toBe(true);
  });

  it("show adds the ref to the live view when one is open", () => {
    const state = liveState();
    const registry = new ViewRegistry(() => "s1");
    const client = fakeClient("s1");
    registry.open(client);
    const a = secretOf(state, "a");
    const b = secretOf(state, "b");
    registry.show("p1", a);
    registry.show("p1", b);
    expect(client.view?.has(a)).toBe(true);
    expect(client.view?.has(b)).toBe(true);
  });

  it("hide removes the ref from the live view and from later restores", () => {
    let session: string | undefined = "s1";
    const state = liveState();
    const registry = new ViewRegistry(() => session);
    const a = secretOf(state, "a");
    const b = secretOf(state, "b");
    const first = fakeClient("s1");
    registry.open(first);
    registry.show("p1", a);
    registry.show("p1", b);
    registry.hide("p1", a);
    expect(first.view?.has(a)).toBe(false);
    expect(first.view?.has(b)).toBe(true);
    session = "s2";
    const second = fakeClient("s2");
    registry.open(second);
    registry.restore("p1", second);
    expect(second.view?.has(a)).toBe(false);
    expect(second.view?.has(b)).toBe(true);
  });

  it("hide is a no-op without a remembered ref or live session", () => {
    const registry = new ViewRegistry(() => undefined);
    expect(registry.hide("nobody", secretOf(liveState(), "a"))).toBeUndefined();
  });

  it("restore is a no-op while the session has no open view", () => {
    const registry = new ViewRegistry(() => "s1");
    const ref = secretOf(liveState(), "p1");
    registry.show("p1", ref); // the session resolves, but nothing is opened yet
    registry.restore("p1", fakeClient("s1"));
    const client = fakeClient("s1");
    registry.open(client);
    registry.restore("p1", client);
    expect(client.view?.has(ref)).toBe(true);
  });

  it("close removes the session's view; shows and hides without a view only touch the memory", () => {
    const state = liveState();
    const registry = new ViewRegistry(() => "s1");
    const client = fakeClient("s1");
    registry.open(client);
    registry.close("s1");
    const kept = secretOf(state, "kept");
    const dropped = secretOf(state, "dropped");
    registry.show("p1", kept);
    registry.show("p1", dropped);
    registry.hide("p1", dropped);
    registry.open(client);
    registry.restore("p1", client);
    expect(client.view?.has(kept)).toBe(true);
    expect(client.view?.has(dropped)).toBe(false);
  });

  it("forget drops the remembered refs of a seat", () => {
    const registry = new ViewRegistry(() => "s1");
    const ref = secretOf(liveState(), "p1");
    registry.show("p1", ref);
    registry.forget("p1");
    const client = fakeClient("s1");
    registry.open(client);
    registry.restore("p1", client);
    expect(client.view?.has(ref)).toBe(false);
  });
});
