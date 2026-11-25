/**
 * The longest a host pause may last, in ms (30 minutes). A pause that outlasts it is treated as an
 * abandoned game: the runtime ends it to the Lobby with `CoreStrings.pausedTooLong` in the notice.
 * A fixed limit, not an option, so a host cannot leave every seat frozen indefinitely.
 */
export const MAX_PAUSE_MS = 30 * 60 * 1000;
