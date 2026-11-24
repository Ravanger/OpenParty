# @openparty/game-kit

The dev-side game declaration. A game declares itself once with `defineGamePackage` — what to host, how to launch it and who plays it — and its entry files become one-line stubs that call the kit's entry functions. Each entry lives on its own export subpath (`./serve`, `./launch`, `./play`, `./bots`, `./demo`), so a deployable `server.ts` evaluates none of the terminal, launcher or bots packages; the root export keeps only `defineGamePackage` and the types. Dev-side only: no browser package depends on it.

## Declaring a game

A game root holds `gamePackage.ts` (the declaration) and `src/meta.ts` (the browser-safe constants, imported by the UI so they stay out of the server-only definition):

```ts
// src/meta.ts
export const META = { roomName: "word_war", minPlayers: 2, maxPlayers: 8 } as const;
```

```ts
// gamePackage.ts
import { defineGamePackage } from "@openparty/game-kit";

export const gamePackage = defineGamePackage({
  meta: META,
  displayName: "Word War",
  load: (env) => loadWords(contentDir(env, import.meta.url)),
  definition: (words) => createWordWarGame({ words }),
  stateClass: WordWarState,
  isFinished: (state) => state.phase === PHASE.Results && state.isFinalRound,
  botKit: wordWarKit(),
  terminal: wordWarTerminal,
  demo: { roomOptions: { totalRounds: 2 }, bot: { thinkMs: [2000, 9000], reactMs: [1000, 4000] } },
});
```

`defineGamePackage` types and returns a `GameDeclaration` unchanged. Fields:

| Field | What |
|---|---|
| `meta` | the browser-safe `{ roomName, minPlayers, maxPlayers }` from `src/meta.ts`; bounds every entry's usage lines |
| `displayName?` | the launcher name; `meta.roomName` when omitted |
| `load?(env)` | loads server-side content from disk; without it `definition` is called with `undefined` |
| `definition(content)` | builds the `defineGame` result for the loaded content |
| `textFilter?` | the room's `TextFilter` (`@openparty/content/filter`); `serve` hands it to the server starter, which checks player names and the game's filtered actions |
| `stateClass` | the synced state class (a `BaseGameState` subclass) |
| `publicFields?` | the state's public fields, handed to the server as `HostedGame.publicFields`; a field neither listed here nor tagged `.view()` (fields of `BaseGameState` excepted) fails the server at startup |
| `isFinished(state)` | true once the game is over; the demo tables and the demo run watch for it |
| `botKit?` | the game's `BotKit` (`roomName`, `stateClass`, `strategy`); optional — without it `serve` and `launch` keep working, but `botsCli`, `demoCli` and `play` print "This game declares no bots." and exit 1 |
| `terminal?` | `() => TerminalStrategy`; without it `play` prints "This game has no terminal strategy." and exits 1 |
| `demo?` | extras beyond the kit: `kit`, `roomOptions`, `hostName`, `bot` (pacing), `commentator` (a factory created once per run, returning `narrate(state)` lines and optional `problems(state)` checks) and `passMessage` |

## Entry functions

Each entry file is a stub that imports its function from the matching subpath; only `launch` takes `gameDir`, the directory of the stub:

| Stub | Subpath | Calls | What it does |
|---|---|---|---|
| `server.ts` | `@openparty/game-kit/serve` | `serve(pkg)` | loads the content (`pkg.load` with `io.env`, or `undefined`), builds the hosted game and starts the Bun game server plus code API on `PORT`/`API_PORT` (defaults 2567/3001; `startServer` validates them as whole numbers 1-65535); a failure prints one line and exits 1 |
| `launch.ts` | `@openparty/game-kit/launch` | `launch(pkg, { gameDir, ports? })` | builds a `LaunchConfig` from the declaration — `name` from `displayName` (or `meta.roomName`), bots capped at `maxPlayers - 1`, demo tables between `minPlayers - 1` and `maxPlayers - 1` bots finished by `isFinished` with the `demo` extras merged in, `ports` (a partial of the launcher's `DEFAULT_PORTS`) forwarded when given — and runs it with `io.argv` |
| `bots/cli.ts` | `@openparty/game-kit/bots` | `botsCli(pkg)` | seats bots in a room made elsewhere, `<CODE> [count]` bounded by `meta.maxPlayers - 1`, plus `--endpoint`, `--api-port` and `--bot-skill=<0..1>` (the bots' skill, default 0.5); the SIGINT handler removes them and exits 0; bad arguments exit 2, a failed join exits 1, and a declaration without `botKit` exits 1 with "This game declares no bots." |
| `terminal/play.ts` | `@openparty/game-kit/play` | `play(pkg)` | one human at a terminal driven by `pkg.terminal`, optionally with bots; starts a server when the endpoint defaults are used and no room is joined; exit 2 on bad arguments, 1 on failure, when the game has no `terminal`, or when it declares no bots (the client needs the kit's state class) |
| `terminal/demo.ts` | `@openparty/game-kit/demo` | `demoCli(pkg)` | one all-bot game on its own server with a PASS/FAIL verdict; `--bots N` (both the space and `=` forms) defaults to 3 and must stay within `meta.minPlayers - 1 .. meta.maxPlayers - 1` and is parsed by `parseDemoArgs` (anything else exits 2); run it as `bun run demo` in a game folder or `bun run demo <game>` from the repo root; exit 0 on PASS, 1 on FAIL, when loading fails, or when neither `botKit` nor `demo.kit` is declared |

## Internal helpers

Not exported from any subpath; the entry files use them directly.

- `hostedGame(pkg, content)` — the `HostedGame` a server hosts: `meta.roomName`, `definition(content)`, `stateClass` and, when declared, `publicFields`.
- `buildLaunchConfig(pkg, { gameDir, ports? })` / `demoTableOptions(pkg, connection)` — the pure parts of `launch`: the `LaunchConfig`, and the per-connection `DemoTableOptions` its demo tables are built from. The declaration's `demo` extras (kit, room options, host name, bot pacing) merge under the connection's; the config omits its bot section when there is no `botKit` and its demo section when neither `botKit` nor `demo.kit` is declared, so asking the launcher for `--bots`/`--demo` then fails with "`<name>` has no bots"/"has no demo", and calling `demoTableOptions` on such a declaration throws. `ports` (a partial of the launcher's `DEFAULT_PORTS`) is forwarded when given, so a game can move the client port without editing the Vite preset — the launcher pins Vite to it with `--port`. `play` derives its join links from `DEFAULT_PORTS.clientDev` the same way. `demoCli` resolves its run's `bot` options the same way — connection over declaration over defaults; only this path seeds the entry's `log` as the lowest default, while the launcher's demo tables start from empty bot options (a bot logs only when its connection or the declaration supplies a `log`).

### Per-entry io defaults

Each entry exports its own process default alongside its function: `serveIo`, `launchIo`, `playIo`, `botsIo` and `demoIo`. Each spreads `processIo()` — the six plain process basics (`env`, `argv`, `exit`, `log`, `error`, `onSignal`) — plus the one capability its entry needs for real (`startServer` for `serve`, a lazy import of `@openparty/server/bun`; `runLauncher` for `launch`; `prompter` for `play`), and throwing stubs for the capabilities it does not use, so an accidental cross-entry call fails loudly instead of silently doing someone else's job. The entry functions take their io as an optional argument; when omitted they use their own default, so entries have no process-bound branch and tests pass fakes. `serve`, `play` and `demoCli` print one line and exit 1 when loading content or running fails.

## Types

- `GameMeta`: room name and player bounds (`roomName: string`, `minPlayers: number`, `maxPlayers: number`).
- `ServeOptions`: config for `serve()` (`games: HostedGame[]`, `port?: number`, `apiPort?: number`, `textFilter?` — the declaration's filter).
- `GameDemoOptions`: the declaration's `demo` field (`kit?`, `roomOptions?`, `bot?`, `hostName?`, `commentator?`, `passMessage?`).
- `DemoCommentator`: what a game's `commentator` factory returns — `narrate(state)` lines and optional `problems(state)` checks for one demo run.
- `GameDeclaration`: the declaration object `defineGamePackage` types and returns (the fields above).
- `GameKitIo`: the injectable process — `env`, `argv`, `exit`, `log`, `error`, `onSignal` plus the `prompter`/`startServer`/`runLauncher` capability seams; each entry's exported default (`serveIo` and friends) is one of these.
