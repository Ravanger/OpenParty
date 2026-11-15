import type { BaseGameState } from "@openparty/shared/schema";
import type { GameDeclaration } from "./types.js";

/** Types a game's declaration and returns it unchanged. */
export const defineGamePackage = <TState extends BaseGameState, TContent>(
  pkg: GameDeclaration<TState, TContent>,
): GameDeclaration<TState, TContent> => pkg;
