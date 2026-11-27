# @openparty/bots

Bot players for any game: you write the strategy, the package handles joining, naming, pacing, and hosting.

| Import | What |
|---|---|
| `@openparty/bots` | `joinBots`, `joinKitBots`, `BotTable`, `DemoTable` to seat bots, `BotPlayer` (one named, paced bot), `ColyseusConnector` and `defaultConnector` to open rooms, `composeStrategies` (round modules), `mistakeChance` (skill → error probability); types `BotStrategy`, `BotKit`, `BotRoom` for your game; option types `JoinBotsOptions`, `JoinKitBotsOptions`, `BotTableOptions`, `SeatBotsOptions`, `DemoTableOptions`, `BotHostOptions`, `DelayRange` |

## Write a strategy

`play(turn)` runs on every state change. `once` runs a step the first time its key is seen in a phase, `later` delays it (cancelled on phase change), `act` sends an action.

```ts
import type { BotKit, BotStrategy } from "@openparty/bots";

const pressBot: BotStrategy<ButtonState> = {
  play: (turn) => {
    if (turn.state.phase === "Round") {
      turn.once("press", () => turn.later("react", () => turn.act("PRESS")));
    }
  },
};

export const buttonKit: BotKit<ButtonState> = {
  roomName: "button",
  stateClass: ButtonState,
  strategy: pressBot,
};
```

| `turn` member | What |
|---|---|
| `state`, `playerId`, `name` | the synced state and this bot |
| `skill` | this bot's skill, 0..1 (default 0.5) — see below |
| `once(key, run)` | runs `run` the first time `key` is seen in this phase |
| `later(speed, run)` | runs `run` after a `"think"`, `"react"` or `[min, max]` ms delay |
| `every(ms, run)` | runs `run` every `ms` — rescheduling after each run — while the phase is unchanged and the bot stays in the room; a throwing `run` is logged through `log` (when set) and stops the cadence; a synchronously-fired scheduler ends the cadence after the first firing instead of recursing (`@experimental`) |
| `act(type, payload?, note?)` | sends an action; the result goes to `log` and `onOutcome` |
| `pick(items)` | a random item, `undefined` for an empty list |

## Act as the host

A bot created with `bot: { host: { expectedPlayers } }` is the host: it sends `START_GAME` once `canStart` holds and that many seats are named, then runs the optional `host(turn)` on every state change, before `play`.

```ts
const strategy: BotStrategy<ButtonState> = {
  play: pressBot.play,
  host: (turn) => {
    if (turn.state.phase === "Lobby") turn.once("options", () => turn.act("SET_OPTIONS", { rounds: 3 }));
  },
};
```

## Round modules

`composeStrategies(base, { [prefix]: strategy })` (`@experimental`) builds one `BotStrategy` for a game with round modules: the strategy mounted under a prefix plays in its `<prefix>_<Phase>` phases (the longest matching prefix wins), the base plays in every other phase, and both `host` hooks run when present — base first. Use the composed strategy as your kit's `strategy`.

```ts
import { composeStrategies, type BotStrategy } from "@openparty/bots";

const strategy: BotStrategy<MyState> = composeStrategies(baseBot, { MOD: modBot });
```

## Seat bots in a room

All entry points take the kit plus `endpoint` and `apiPort`.

```ts
import { BotTable, joinBots } from "@openparty/bots";

const bots = await joinBots({ ...buttonKit, endpoint, apiPort, code: "ABCD", count: 3 }); // an existing room

const table = new BotTable({ ...buttonKit, endpoint, apiPort });
const code = await table.open();         // empty room the table watches
await table.seatBots({ count: 3 });      // once a human has joined and named themselves
```

`joinKitBots({ kit, ... })` is the same seating with the kit passed as `kit` instead of spread. On failure `joinBots` leaves the seats it took.

## Room connector

Every entry point opens rooms through a `RoomConnector` (`@openparty/client-utils`): pass `connector` to `joinBots`, `BotTable` or `DemoTable` to supply one, and a table reuses its connector for the bots it seats. The default is built by `defaultConnector(endpoint, { roomName?, stateClass })`, a `ColyseusConnector` that holds the whole join flow (`joinById`, wait for the state sync, claim a name) over one Colyseus client; `roomName` is only needed to create rooms, so `create` rejects without it. The room code is resolved to an id once per batch — `joinBots` (and the tables, which forward their `resolveCode` option) call `resolveRoomCode` against `apiBaseOf(endpoint, apiPort)` by default and pass the id to every join.

## Run an unattended demo

`DemoTable` opens a watch-only room (room option `seats`) with a host bot, seats the bots and tells you when the game is over.

```ts
import { DemoTable } from "@openparty/bots";

const demo = new DemoTable({
  ...buttonKit,
  endpoint,
  apiPort,
  bots: 3,
  isFinished: (state) => state.phase === "Done",
});
await demo.open();
await demo.seatBots();
await demo.finished();   // rejects if the room closes
await demo.leave();
```

## Tune pacing

`BotOptions` (the `bot` option, or `bot` on the launcher's `create`): `thinkMs` (default `[2000, 6000]`), `reactMs` (`[500, 2500]`) — each a `DelayRange`, a `[minMs, maxMs]` range a random delay is drawn from — `skill` (0..1, default 0.5; see below), `rng`, `schedule`, `log`, `onOutcome`, `host` (`BotHostOptions`: the options that make a bot the host, `expectedPlayers`). `joinBots` takes `JoinBotsOptions` (connection, kit, room code and bot count), including `nameFor(n)` (default `Bot n`), `playerIds` and `timeoutMs`; `BotTable` takes `BotTableOptions` (connection, kit and join options) and `seatBots` takes `SeatBotsOptions` (how many bots to seat and how long, in milliseconds, to wait for a human first); `DemoTable` takes `DemoTableOptions` (connection, kit, bot count and finish rule), including `hostName`, `roomOptions` and `isFinished`.

`skill` scales how fast a bot plays: the ranges drawn for `later("think")` and `later("react")` are multiplied by `1.5 - skill` (1.5× at skill 0, unchanged at the default 0.5, 0.5× at skill 1), while an explicit `[min, max]` range is never scaled. Out-of-range values are clamped to 0..1; a non-finite value falls back to 0.5. Accuracy scales through `mistakeChance(skill)` (`(1 - skill) / 2`, clamped the same way as `skill`), which a strategy rolls its own random number against. `every` and the skill surface are `@experimental` — see the framework guide's Bots section.

Depends on: `@openparty/client-utils`, `@openparty/shared`, `@colyseus/sdk`

Guide: [docs/framework/README.md#bots](../../docs/framework/README.md#bots)
