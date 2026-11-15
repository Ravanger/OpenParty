# @openparty/client-utils

## Responsibility

Browser- and Node-safe client helpers: `waitFor`, `resolveRoomCode`, `joinUrl`, `tvUrl`, `between`, `claimName`, `apiBaseOf`, and the `RoomConnector` interface non-UI clients open rooms through. No `node:` imports, no Colyseus.

## Never put here

- Server or runtime code (that is `core` or `server`), game vocabulary, Svelte or DOM code.
- Anything that needs an `@openparty/*` package besides `shared`.

## May import

- Runtime: `@openparty/shared`
- Dev: `@openparty/config`

## Public entry points

- `.`: `waitFor`, `resolveRoomCode`, `joinUrl`, `tvUrl`, `between`, `claimName`, `apiBaseOf`, `RoomCodeError`, type `RoomCodeFailure`, type `Parsed`, type `SeatRoom`, types `RoomConnector`, `ConnectedRoom`, `RoomCreateOptions`, `RoomJoinOptions`.

## Tests

`tests/`, plain vitest (node). No host helper needed.

## Before you add a file

Is it a client helper both browser and Node can use? If it needs more than `shared`, it belongs in `game-client` or later.
