# @colyseus/schema Documentation

> **Version:** 5.0.35 (`packages/server`, `games/wit-clash`)

## Overview
Binary delta-encoded state. `BaseGameState` and `PlayerSchema` (`packages/shared/src/schema/`) and the WitClash classes (`games/wit-clash/src/state.ts`) are defined with `schema()`; clients mirror them through `@colyseus/sdk`. Schema 5 is decorator-free: no `experimentalDecorators`, no `useDefineForClassFields: false`, no `ts-transform` Vitest plugin, no `oxc: false`.

## Syntax
```ts
import { type SchemaType, schema, t } from "@colyseus/schema";

export const Answer = schema({ id: t.string().default(""), votes: t.number().default(0) }, "Answer");
export type Answer = SchemaType<typeof Answer>;          // value and type share a name

export const MyState = BaseGameState.extend({
  answers: t.array(Answer),                               // collections default to empty
  progress: t.map("number"),                              // primitive elements take the type NAME
  mine: t.map(PlayerPrivate).view(),                      // StateView-only
}, "MyState");
export type MyState = SchemaType<typeof MyState>;
```
- The second argument names the class for reflection; keep it unique and equal to the const name.
- `schema()` returns a real class (`new Answer()`, `instanceof`). Initial values may be passed: `new Answer({ id: "a" })`.
- `.extend(fields, name)` subclasses; this is how a game extends `BaseGameState`. Methods can be declared in the same object.
- `t.string<"host" | "player">()` refines the type only (the wire is a plain string); used for `PlayerSchema.role`.
- `@type`/`@view()` decorators still work and produce the same wire format; do not use them in new code. `defineTypes` is deprecated.

## Used in this repo
| API | Usage |
|---|---|
| `schema`, `t.string/number/boolean`, `.default()` | Every primitive field, always with a default. |
| `t.array(X)`, `t.map(X)`, `t.map("number")` | Collections; no initialiser needed. |
| `.view()` | `mine` (per-player private data). See below. |
| `SchemaType<typeof X>` | Instance types. |
| `StateView` | Created per client in `GameRoom.onJoin` (`client.view = new StateView()`). |
| `Encoder`, `Reflection` | `BaseGameState.test.ts` proves a game state encodes and reflects. |

## StateView (per-player visibility)
- A `.view()` field is sent only to clients whose `StateView` contains the **instance** that holds it, or, for a collection item, the item. `state.mine` is a `.view()` map; each player's entry is a child `PlayerPrivate` instance revealed with `view.add(entry)` (core: `ctx.showTo(playerId, entry)`; revoke with `view.remove`, core: `ctx.hideFrom`).
- A client without the entry in its view never receives the map key either: entries appear and disappear in `state.mine` as the view changes.
- `GameRoom` keeps `playerId -> Set<ref>` and re-adds the refs when a seat is re-attached by a new session. On a token reconnect Colyseus carries the old `StateView` over to the new client.
- Remove an entry from the view **before** deleting it from the map.
- 5.x also has `view.subscribe(collection)` (standing subscription) and `t.stream()`; not used.

## Gotchas
- **63 fields per class**; `schema()` throws at definition time beyond that. Declare frequently mutated tagged fields among the first 32 (faster change classification).
- Primitive collection element types are names (`"number"`), never builders: `t.map(t.number())` is wrong.
- Only synchronised, client-visible data belongs in a Schema. Server-private data lives in `ctx.priv`. `.noSync()` gives a local-only typed field.
- Mutate in place (`map.set`, `seat.isConnected = false`); never replace a nested instance when avoidable. Reconnect and patches rely on object identity: the client keeps the same `Schema` instances across an automatic reconnect.
- Do not mock `@colyseus/schema` in tests; `BaseGameState.test.ts` encodes a real state.
- Client side: `room.state` is decoded from reflection unless a root class is passed as the third argument of `create/joinById` (`rootSchema`). Prefer `Callbacks.get(room)` from `@colyseus/sdk` (`listen`, `onAdd`, `onRemove`, `onChange`, `bindTo`); see [colyseus.md](colyseus.md).

## Pluggable state slices
- A round module attaches a slice to the game state as **one generic nested ref declared once on the state class**, mutated in place between rounds. Concrete shape:
  ```ts
  export const Slice = schema(
    {
      round: t.number().default(0),
      label: t.string().default(""),
      scores: t.map("number"),
      payload: t.string().default(""),   // optional JSON string for module tuning
      mine: t.map(Note).view(),          // per-player private data
    },
    "Slice",
  );
  export const SliceState = BaseGameState.extend({ slice: Slice }, "SliceState");
  ```
  `tests/stateSlice.test.ts` (fixture `fixtures/stateSlice.ts`) proves it: the client sees the slice with a root class **and** with a reflection decode (no root class at join), a `.view()`-tagged nested map reaches only each owner, and the slice survives a token reconnect.
- The slicing surface for #302 is therefore a stable selector `(state) => TSlice`; `assertSyncedFields` needs no change — the top-level `slice` field is listed in `HostedGame.publicFields`, nested classes are not checked (they inherit the holding field's visibility), and nested `.view()` maps inside the slice work per-item revealed via `ctx.showTo`.
- Constraints: (1) mutate the slice in place on module entry/exit — never replace the slice instance; patches and reconnect rely on the same instances. (2) Give the slice field a `publicFields` entry. (3) Hide private entries from the view (`ctx.hideFrom`) **before** deleting them from the map. (4) Join with a root class in production code; without one the SDK decodes from reflection into dynamic mirror classes — the shape is right, but the instances are not `instanceof` the game's schema classes.
- Measured patch cost (fresh state filled like `SET_MODULE` — 2 scores, 2 notes; full encode + `discardChanges`, then one teardown mutation, `encode` for the shared frame and `encodeView` for one client's frame). Note: the harness is a one-off (not committed), so the numbers below are a point-in-time measurement, not a regression gate — re-run it by hand (`encode`/`encodeView` on a filled state, discard, one mutation) if the shape changes:
  | Teardown | Shared frame | Per-client frame |
  | --- | --- | --- |
  | clear-in-place (hide the notes from the views, delete them, reset scalars and scores) | 11 B | 19 B |
  | reassign (`state.slice = new Slice()`) | 12 B | 12 B |
  At this scale both are about a dozen bytes. The split differs: clear-in-place is one shared byte cheaper but pays ~8 B per client for each hidden note, while reassign sends no per-view bytes at all — the old notes are never removed from the clients' views, they simply become unreachable with the replaced slice. The decision is not byte-driven (in-place scales with the number of changed entries, not the whole new structure); it rests on the identity/reconnect constraint and the single-slice selector. Reassigning also changes the ref identity, and remembered `.view()` refs of a re-attached seat can linger over entries that no longer exist in the map.
- Rejected: **(b) one optional typed ref per module** — works, but every module needs its own declared ref and `publicFields` entry, so adding a module is a state-class edit; the selector `(state) => TSlice` must become a union of per-module refs. **(c) one polymorphic ref assigned a variant instance on entry** — decodes (variant instance reaches the client), but every module must extend a single shared base, every client casts the ref to that variant, and module entry is the reassign pattern. No win over shape (a) for the pluggable-slice goal.

## References
- [Schema docs](https://docs.colyseus.io/state), `packages/shared/src/schema/BaseGameState.ts`, `games/wit-clash/src/state.ts`
