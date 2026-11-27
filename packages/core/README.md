# @openparty/core

Pure game runtime (no Colyseus, no I/O): define phases and rules, dispatch actions, own the clock.

| Import | What |
|---|---|
| `@openparty/core` | `defineGame`, `actionFactory`, `GameRuntime`; shared action building blocks `EmptyPayloadSchema` (the payload of an action with no fields; extra wire keys are stripped) and `playAgainAction()` (host-only return-to-lobby action a game puts in its own end phase under its own action name); join control `evaluateJoin(definition, input)` (the pure evaluation of the definition's optional synchronous `canJoin` hook; types `CanJoinInput`, `CanJoinResult`, `JoinGate`); options resolution `resolveGameOptions(definition, raw)` → `{ ok: true, options } | { ok: false, reason: "unexpected" | "invalid" | "too-large" }` (the one room-options contract: a game without an `options` schema accepts no keys, then the schema parse, then the `MAX_OPTIONS_JSON_LENGTH` cap; pure — Zod text never reaches the result; types `ResolvedGameOptions`, `OptionsRejectionReason`); `CoreStrings`, `defaultCoreStrings`; the logging types `Logger`, `ContextLogger`, `LogLevel`, `LogFields`, `LogLine` and the no-op `noopLogger` (see the guide's Logging section); `leaderboard`, `composeLeaderboard`, `awardPoints` (types `LeaderboardInput`: scores and names a leaderboard is composed from, seated players first; `LeaderboardEntry`: one ranked row); roster guards `seatedCount(ctx)`, `isBelowMinimum(ctx, min)`, `departedIds(ids, ctx)`, `endIfBelowMinimum(ctx, min, notice)` (below the minimum it sets `state.notice` and queues the return to the lobby), `RosterLedger` (a private-state ledger of names and participants: `remember(ctx)`, `nameOf(ctx, id)`, `participantIds`, `rememberedNames`, `drop(id)`, `clear()`) and the synced per-player entry helpers `ensureMine(ctx, mine, playerId, create)`, `resetMine(ctx, mine)`, `pruneMine(ctx, mine, ids)`; `shuffle`, `weightedSample(items, count, rng, weightOf)` (a weighted draw without replacement: items with a weight of 0 are never picked, equal weights deal a uniform shuffle, and there is no default rng), `required`; seeded RNG `sfc32`, `Seed`, `randomSeed`, `seedFromNumber`, `mulberry32`, `newId` and the daily-seed helpers `utcDay(nowMs)` (the UTC date of an epoch-ms timestamp as `YYYY-MM-DD`) and `dailyRng(day, salt)` (FNV-1a of `${day}:${salt}` seeds `mulberry32`, so every server on the same day draws the same sequence per salt); action-log validation `ActionLogSchema` (input-bounded: safe-integer `t`/`seq`/`startedAt`, at most 100,000 entries, plain-object action payloads — see the guide's Input limits) and `DuplicateActionLogMiddlewareError` (thrown when a second `actionLogMiddleware()` instance records for a priv that already has a log), `ACTION_LOG_ENTRY_KINDS` (the single list of entry kinds the entry schema and the replay walk dispatch on) and `AudienceScopes` (once-per-scope tracking for seatless audience senders: `once(audienceKey, scope)` is true only on first use per key+scope, `clear()` forgets everything — hosts clear it on phase transitions); middlewares `actionLogMiddleware()` (append-only, JSON-serializable record of every middleware-visible event kept outside `ctx.priv`, read back with `getActionLog(priv)`; records the live tick count as `ticks` on every entry while a ticking phase is active, so replay can cap tick delivery at it; one instance per game), `loggingMiddleware()` (one console line per enter/timeout/action/transition; none for roster changes), `timingMiddleware()` (per-phase timing records kept outside `priv`, read back with `getPhaseTimings(priv)`) and `textFilterMiddleware(filter)` (rejects a player or audience action whose declared text fields fail the room's filter level, with the fixed core message `CoreStrings.contentRejected`; see the guide's Phase middleware section); host pause limit `MAX_PAUSE_MS` (30 minutes — a pause that outlasts it ends the game to the Lobby) |
| `@openparty/core/awards` | `AwardDefinition` (`{ id, title, reduce(entries, roster), higherIsBetter? }` — a pure reducer over action-log entries), `computeAwards(log, defs)` → `AwardResult[]` (`{ id, title, scores, winners }`, ties shared, no winner for an empty score map); rejected log entries are filtered out before the reducers run |
| `@openparty/core/kits` | Phase kits (`@experimental`). collectResponses: `allResponded(slots, responses, presentIds)`, `entriesFor(slotId, slots, responses)`, types `Slots`, `Responses`. voteAndTally: `tallyVotes(voterIds, votes)`, `allHaveVoted(voterIds, votes)`, `countVoted(voterIds, votes)`, `eligibleVoters(activeIds, excludedIds)`, `leaders(counts)` → `{ top, ids }`. drawPool: `drawPool(items, usedIds, needed)` → `{ items, exhausted }` (on exhaustion it clears the drawn ids from the mutable `usedIds`). Round modules (self-contained sub-games over a slice of the host's state; see the guide's Round modules section): `defineRoundModule(module)` (validates the module's local names at definition time), `mountRoundModule(module, { prefix, slice, priv, params, onDone })` → host phases to spread into `GameDefinition.phases` (phases become `<prefix>_<Phase>`, actions `<PREFIX>__<ACTION>`; a duplicate prefix (the same module twice, or two modules sharing one) and a game-declared phase shadowing a mount's phase are rejected by `defineGame`), `roundModuleActionFactory<TSlice, TPriv, TParams>()` (type binding for a module's actions); types `RoundModule`, `RoundModulePhase`, `RoundModuleAction`, `RoundModuleContext`, `RoundModuleActionContext`, `MountRoundModuleOptions`. turnOrder: `createTurnOrder(ids, rng)` (a fresh deterministic shuffle), `nextTurn(order, current, presentIds)` (next present id, wrapping; `undefined` when none is present). teams: `assignTeams(ids, shape, rng, history?)` (deterministic partition into positive-integer sizes summing to the id count; rotates single-seat teams through `history`), `teamTotals(scores, teams)` (one score sum per team, missing ids count as 0). graph: type `Graph` (a record from a node id to its outgoing ids), `reachable(graph, from, steps)` → `{ ends, branches }` (nodes a walk can end on plus each branch point once; terminates on cycles), `shortestPath(graph, from, to)` (fewest-edge route as a node list, `undefined` when unreachable), `validateGraph(graph, starts)` (all problems in one list: unknown edge endpoints, unknown starts, an empty starts list, nodes no start reaches) |
| `@openparty/core/replay` | `replayLog(definition, log, init)` (re-drives a fresh runtime over a recorded action log, returns state snapshots; input-bounded — timer fires are capped per advance and per run, and tick delivery is capped at the counts the entries record, see the guide's Input limits), `ReplayHost` (minimal `RuntimeHost`: manual clock, seats, given seed); replay bundles: `createBundle(parts)`, `parseBundle(json)`, `hashBundle(bundle)` (sha-256 hex of canonical JSON), `verifyBundle(bundle)`, `ReplayBundleSchema` |
| `@openparty/core/testing` | `FakeHost` (manual clock, in-memory seats; captures every `ctx.log` line in `logs`; `Sent` is a message it recorded as sent to one player), `TestTable` (scenario boilerplate); re-exports `replayLog` from `./replay` |

## Define a game

Named phases, each with optional `onEnter`, `duration` + `onTimeout`, `onTick(ctx, dtMs)` (real-time phases; rate and determinism rules in the guide's Timers section), `onRosterChange` and `actions`. `Lobby` is built in; `startPhase` is where `START_GAME` goes. Move between phases only with `ctx.transition("Name")`.

```ts
import { actionFactory, defineGame } from "@openparty/core";
import { z } from "zod";

interface ButtonState { phase: string; phaseEndsAt: number; phaseDurationMs: number; canStart: boolean; winner: string }
interface Priv { presses: string[] }

const action = actionFactory<ButtonState, Priv, Record<string, unknown>>();

export const ButtonGame = defineGame<ButtonState, Priv>({
  name: "FirstToPress",
  minPlayers: 2,
  maxPlayers: 8,
  startPhase: "Round",
  createPrivateState: () => ({ presses: [] }),
  phases: {
    Round: {
      duration: 10_000,
      onEnter: (ctx) => ctx.activateWaitingPlayers(),
      onTimeout: (ctx) => ctx.transition("Done"),
      actions: {
        PRESS: action({
          from: "player",
          payload: z.object({}),
          handler: (ctx) => {
            ctx.priv.presses.push(ctx.playerId);
            ctx.state.winner = ctx.playerId;
            ctx.transition("Done");
          },
        }),
      },
    },
    Done: { duration: 3_000, onTimeout: (ctx) => ctx.returnToLobby() },
  },
});
```

`defineGame` throws a `GameDefinitionError` listing every problem; `START_GAME`, `KICK_PLAYER`, `SET_OPTIONS`, `END_GAME`, `PAUSE_GAME` and `RESUME_GAME` are built-in action names (pause freezes the current phase's timer, ticks and queued actions until resume shifts the deadline; see the guide's Host controls section). An action may declare its own token bucket as `rateLimit: { rate, burst }` (`ActionRateLimit`; rate in actions per second, burst the tokens held at once), which the server keys by action type so a fast action does not spend the room's shared budget; `defineGame` rejects a rate that is not a finite number `> 0`, a burst that is not an integer `>= 1`, or either above `ACTION_RATE_LIMIT_CEILING` (100/s, burst 200).

## Localisation

Every message the core owns (the lobby built-ins' refusals, the failure notice in `state.notice`, the stopped-runtime error, the text-filter rejection and the runtime's refusal log messages) comes from `defaultCoreStrings`. Pass a partial table as the definition's `strings` field to replace any of it; `defineGame` fills in the defaults:

```ts
const game = defineGame<ButtonState, Priv>({
  // ...
  strings: { cannotKickSelf: "Du kannst dich nicht selbst rausschmeißen" },
});
```

Function entries receive their arguments (`needAtLeast(minPlayers)`, `notAllowedToSend(action)`). The client-visible entries reach players in `ERROR` payloads or `state.notice`; the log-only ones are `FrameworkError` messages, where clients see the fixed `CLIENT_MESSAGES` text for the code. Game-owned text (your own `ctx.reject` messages) is not part of this table.

## Actions

`from` is `"host"`, `"player"` or `"audience"`. An audience action is dispatched seatless through `runtime.dispatchAudience(audienceKey, raw)`: its handler gets no `playerId`, but an `audience.once(scope)` check that returns `true` once per key and scope (cleared on every phase change). See the framework guide's Audience section. `payload` is a zod schema for the whole action object, read in the handler as `ctx.payload`. `ctx.reject` sends the actor an `ERROR` but does not stop the handler, so return after it.

```ts
import { ErrorCode } from "@openparty/shared";

handler: (ctx) => {
  if (ctx.state.winner !== "") return ctx.reject(ErrorCode.NOT_ALLOWED, "Too late");
  ctx.state.winner = ctx.playerId;
},
```

## Context

`ctx.state` is synced to every client; `ctx.priv` stays on the server. Key maps by `playerId`. Seats: `ctx.players()`, `ctx.activePlayers()`, `ctx.player(id)`. Per-player state goes in a `.view()` field, revealed with `ctx.showTo(playerId, entry)`. `ctx.options` is the room options parsed by the definition's `options` schema; `ctx.rng()` and `ctx.now()` keep rules testable.

## Score points

```ts
import { awardPoints, composeLeaderboard, leaderboard } from "@openparty/core";

const scores: Record<string, number> = {};
awardPoints(scores, "p1", 100);
leaderboard(scores); // [{ playerId, score }], best first
composeLeaderboard({ scores, seatedNames: new Map([["p1", "Ann"]]), rememberedNames: {} });
// adds name and hasLeft; seated players first, then leavers
```

## Test phases without a server

`TestTable` seats `p1..pN` (`p1` hosts) on a `FakeHost` with a manual clock and drives the real runtime. Extend it with scenario steps.

```ts
import { TestTable } from "@openparty/core/testing";

class ButtonTable extends TestTable<ButtonState, Priv, Record<string, unknown>> {
  constructor() {
    super({
      definition: ButtonGame,
      state: { phase: "", phaseEndsAt: 0, phaseDurationMs: 0, canStart: false, winner: "" },
      options: {},
    });
  }
  press(id: string): void {
    this.act(id, "PRESS");
  }
}

const table = new ButtonTable();
table.start();                       // p1 sends START_GAME
table.press("p2");
expect(table.phase).toBe("Done");
table.tick(3_000);                   // advance the clock
expect(table.phase).toBe("Lobby");
```

Without `TestTable`, drive `new GameRuntime({ definition, state, options, host })` over a `FakeHost` (`host.seat("p1")`, `runtime.dispatch("p1", { type: "PRESS" })`, `runtime.runStep(fn)` (one full step: a throw is collected like any failed run and transitions queued by `fn` drain before it returns; ignored once stopped), `host.advance(ms)`, `host.errorsTo("p1")`).

Depends on: `@openparty/content` (types only), `@openparty/shared`, `xstate`, `zod`

Guide: [docs/framework/README.md#concepts](../../docs/framework/README.md#concepts) ([minimal game](../../docs/framework/README.md#minimal-game-first-to-press-the-button), [testing](../../docs/framework/README.md#unit-testing-phases-without-a-server))
