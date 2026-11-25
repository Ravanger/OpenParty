# @openparty/terminal

Terminal client: a human at a prompt, bots, or an all-bot demo run. You write the strategy.

- `@openparty/terminal`: `TerminalPlayer`, `PlaySession`, `ReadlinePrompter`, `DemoRun`, `parsePlayArgs`, `parseDemoArgs`, `runBotsCommand` (throws `BadBotsArgsError` on a bad argv; map it to your bad-arguments exit code); `DEFAULT_ENDPOINT` (`ws://localhost:2567`), `DEFAULT_API_PORT` (3001); types `TerminalStrategy`, `TerminalTurn`, `TerminalPlayerOptions` (optional clock and quit word), `KeyName` (a decoded key press), `GameRoomOf<TState>` (the client-side room), `PlayArgs`, `BotsArgs`, `ArgsLimits`, `PlaySessionOptions`, `DemoRunOptions`, `BotsCommandOptions`, `BotsCommandHandle`
- `@openparty/terminal/testing`: `ScriptedIo`, a scripted `Prompter` (`type` answers a question; `press` delivers a key; `frames` records `frame` calls)

## Write a strategy

`play(turn)` runs once per stage (the phase, unless you give `stageOf`) and not in the Lobby. When the stage changes, the turn's `signal` aborts and a pending `ask` or `changed` rejects, so no cleanup is needed.

```ts
import type { TerminalStrategy } from "@openparty/terminal";

export const buttonTerminal = (): TerminalStrategy<ButtonState> => ({
  async play(turn) {
    if (turn.state.phase !== "Round") return;
    await turn.ask(`Press Enter to press!${turn.timeLeft()}`);
    await turn.send("PRESS", {}, "Pressed.");
    await turn.changed();
  },
  narrate: (state) => (state.phase === "Done" ? [`${state.winner} won`] : []),
});
```

| `turn` member | What |
|---|---|
| `state`, `playerId`, `isHost`, `signal`, `quitWord` | context |
| `ask(question)`, `print(line)` | the trimmed answer (rejects when the stage ends); prints a line |
| `send(type, payload, accepted)` | sends an action, prints `accepted` or the refusal; resolves true when accepted |
| `notify(type, payload)` | sends without waiting or printing |
| `changed()` | resolves on the next state change or when the stage ends |
| `timeLeft()` | `" 12s left"` from the server clock, `""` without a deadline |
| `onKey(handler)` | calls `handler(key)` for each single key press until the stage ends (raw mode; `"up"`, `"enter"`, `"space"`, `"a"`); prints a line and reads nothing without a terminal |
| `frame(lines)` | redraws a block of lines in place (cursor up and clear, no scroll); plain prints without a terminal |
| `quit()` | leaves the game |

Optional: `stageOf(state)`; `narrate(state)` returns lines printed on every state change; `lobby(turn)` replaces the built-in lobby.

`onKey` and `frame` (`@experimental`) are for real-time stages that cannot wait for Enter. `onKey` switches stdin to
raw mode and decodes arrows, space, Enter, Escape, Backspace, Tab and typed characters; it restores the previous mode when
the stage ends, when the player quits and when a handler throws (`Something went wrong: ...`). Registering again inside the
same stage keeps the terminal in raw mode until the last listener ends. `frame` keeps the block where it was: the next call
moves the cursor back to its first line and clears each line, so a score line does not scroll the stage away. On a piped
stdin or a redirected stdout both fall back safely — keys are refused with a printed line and frames become plain prints.

```ts
async play(turn) {
  if (turn.state.phase !== "Round") return;
  turn.onKey((key) => {
    if (key === "up" || key === "a") void turn.send("MOVE", { by: 1 }, "Moved.");
  });
  while (!turn.signal.aborted) {
    turn.frame([`Round — ${turn.timeLeft().trim()}`, "Arrows to move"]);
    await turn.changed();
  }
}
```

## Wire `terminal/play.ts`

`parsePlayArgs` reads `--bots`, `--name`, `--join`, `--endpoint`, `--api-port`. `parseDemoArgs(argv, { minBots, maxBots, usage })` reads `--bots N` (both the space and `=` forms) for an all-bot demo (default 3, clamped into the range; an empty value, a non-integer or out-of-range count, a repeated flag, unknown flags and extra positionals are rejected with `usage`). `PlayArgs`, `BotsArgs` and `DemoArgs` are the parsed command lines; `ArgsLimits` and `DemoArgsLimits` carry the limits and usage text. Entries exit 2 on bad arguments. `PlaySession` (options `PlaySessionOptions`: where the server is, which room to enter, who plays) finds or starts a server, creates or joins a room and seats bots from your `BotKit`; rooms are opened through `GameClient`, a thin wrapper over the default room connector (`defaultConnector`) from `@openparty/bots`.

```ts
import { createInterface } from "node:readline/promises";
import { PlaySession, ReadlinePrompter, TerminalPlayer, parsePlayArgs } from "@openparty/terminal";

const usage = "Usage: bun run play [--bots=0..7] [--name=You] [--join=ABCD]";
const parsed = parsePlayArgs(process.argv.slice(2), { maxBots: 7, usage });
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(2);
}
const lines = createInterface({ input: process.stdin, output: process.stdout });
const { usesDefaults, join } = parsed.value;
const session = new PlaySession(
  {
    ...parsed.value,
    startServer: usesDefaults && join === undefined,
    kit: buttonKit,
    games: [{ roomName: "button", definition: ButtonGame, stateClass: ButtonState }],
    player: (room, playerId, io) => new TerminalPlayer(room, playerId, io, buttonTerminal()),
    clientUrl: "http://localhost:5173",
  },
  new ReadlinePrompter(lines),
);
process.on("SIGINT", () => session.stop());
await session.run();
lines.close();
```

## Wire `bots/cli.ts`

`bun run bots <CODE> [count]` seats bots in a room created in the browser. `parseBotsArgs(argv, { maxBots, usage })` reads the code, the count (default 3), `--endpoint`, `--api-port` and `--bot-skill=<0..1>` — the bots' skill; omitted keeps the default 0.5, and an empty, non-numeric or out-of-range value prints `usage`. `runBotsCommand` takes `BotsCommandOptions`; the flag wins over a `skill` already set in its `bot` options, and the `BotsCommandHandle` it resolves with controls the seated bots.

```ts
import { runBotsCommand } from "@openparty/terminal";

await runBotsCommand({
  kit: buttonKit,
  maxBots: 7,
  argv: process.argv.slice(2),
  out: console.log,
  err: console.error,
  usage: "Usage: bun run bots <CODE> [count=3]",
  onInterrupt: (stop) => process.on("SIGINT", () => void stop().finally(() => process.exit(0))),
}).catch(() => process.exit(1));
```

## Check a game with an all-bot run

`DemoRun` (options `DemoRunOptions`: kit, bot count and verdict hooks) plays one game on its own server and prints `PASS` or `FAIL`: it fails on a refused bot action, no finish within `timeoutMs` (default 180 s), or lines from the optional `problems(state)`.

```ts
import { DemoRun } from "@openparty/terminal";

const passed = await new DemoRun({
  games: [{ roomName: "button", definition: ButtonGame, stateClass: ButtonState }],
  kit: buttonKit,
  bots: 2,
  finished: (state) => state.phase === "Done",
  out: console.log,
}).run();
process.exit(passed ? 0 : 1);
```

## Test a strategy

`ScriptedIo` (from `@openparty/terminal/testing`) is a `Prompter` that records `asked` and `printed` lines; `await io.type("text")` answers the pending question, `io.press("up")` delivers a single key to the stage's `onKey` listeners (`io.listening` says whether any is left), and `io.frames` records every `frame` call. Pass it to `TerminalPlayer` or `PlaySession`.

Depends on: `@openparty/bots`, `@openparty/client-utils`, `@openparty/server`, `@openparty/shared`, `@colyseus/sdk`

Guide: [docs/framework/README.md#terminal](../../docs/framework/README.md#terminal)
