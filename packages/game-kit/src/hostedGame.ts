import type { HostedGame } from "@openparty/server";
import type { BaseGameState } from "@openparty/shared/schema";
import type { GameDeclaration } from "./types.js";

/** The `HostedGame` a server hosts for this declaration and its loaded content. */
export function hostedGame<TState extends BaseGameState, TContent>(
  pkg: GameDeclaration<TState, TContent>,
  content: TContent | undefined,
): HostedGame {
  return {
    roomName: pkg.meta.roomName,
    definition: pkg.definition(content as TContent),
    stateClass: pkg.stateClass,
    ...(pkg.publicFields ? { publicFields: pkg.publicFields } : {}),
  };
}
