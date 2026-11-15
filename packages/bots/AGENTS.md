# @openparty/bots

## Responsibility

Bot players for any game: `BotPlayer`, `joinBots`, `BotTable`, `DemoTable`, driven by a game-supplied `BotStrategy`.

## Never put here

- Game-specific strategies (they live in the game).
- Generic client helpers such as `claimName` and `apiBaseOf` (they live in `@openparty/client-utils`).
- Terminal I/O or rendering.

## May import

- Runtime: `@openparty/client-utils`, `@openparty/shared`
- Dev: `@openparty/config`, `@openparty/core`, `@openparty/server`

## Public entry points

- `.`: `BotPlayer`, `joinBots`, `BotTable`, `DemoTable`, `ColyseusConnector`, `BotStrategy`, `BotKit`.

## Tests

`tests/`; boot a real server with `bootTestServer` from `@openparty/server/testing`.

## Before you add a file

Does it decide or pace a bot move? A generic client helper -> `client-utils`; terminal-only -> `terminal`.
