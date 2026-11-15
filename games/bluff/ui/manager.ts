import type { GameConnectionManager } from "@openparty/game-client";
import type { BluffState } from "../src/state.js";

/** The connection manager for this game's client, typed on its state. */
export type BluffManager = GameConnectionManager<BluffState>;
