# @openparty/wit-clash (reference game)

## Responsibility

The reference game: rules, UI screens, content and entry points, built only on the framework packages.

## Never put here

- Reusable framework code (hoist to `packages/`).
- Imports from other games.
- Hand-rolled server, bot, terminal or launch plumbing; game-kit owns it.

## May import

- Runtime: `@openparty/bots`, `@openparty/content`, `@openparty/core`, `@openparty/game-client`, `@openparty/game-kit`, `@openparty/game-ui`, `@openparty/server`, `@openparty/shared`, `@openparty/terminal`
- Dev: `@openparty/config`

## Public entry points

- No `exports`. Entries: `server.ts`, `launch.ts`, `ui/main.ts`, `bots/cli.ts`, `terminal/play.ts`.
- Content: `content/categories/*.jsonc`.

## Tests

`tests/game/` (rules, `Table extends TestTable`), `tests/viewmodels/`, `tests/screens/` (`StubRoom`).

## Before you add a file

Is it WitClash rules, screens or content? If another game could reuse it -> the matching package.
