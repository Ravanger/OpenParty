# @openparty/__slug__

## Responsibility

The __DisplayNameMd__ game: rules, UI screens and entry points, built only on the framework packages.

## Never put here

- Reusable framework code (move it to the matching `packages/` package).
- Imports from other games.

## May import

- Runtime: `@openparty/bots`, `@openparty/core`, `@openparty/game-client`, `@openparty/game-kit`, `@openparty/game-ui`, `@openparty/shared`, `@openparty/terminal`
- Dev: `@openparty/config`

## Public entry points

- No `exports`. Entries: `server.ts`, `launch.ts`, `ui/main.ts`, `bots/cli.ts`, `terminal/play.ts`.

## Tests

`tests/game/` (rules), `tests/bots/`, `tests/terminal/`, and UI tests under `tests/`.
