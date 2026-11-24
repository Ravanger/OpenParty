import { connectedClient } from "@openparty/game-client/testing";
import { BaseGameState } from "@openparty/shared/schema";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "../src/AppRouter.js";
import { prefixedScreens } from "../src/prefixedScreens.js";

interface Screen {
  label: string;
  banner: string;
}

const tapScreen: Screen = { label: "Tap", banner: "" };
const revealScreen: Screen = { label: "Reveal", banner: "RESULTS!" };

const screens = prefixedScreens({ Tap: tapScreen, Reveal: revealScreen }, "MOD");
const incomplete = prefixedScreens({ Reveal: revealScreen }, "MOD");

type KnownPhase = "Lobby" | "MOD_Tap" | "MOD_Reveal";
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

describe("prefixedScreens", () => {
  it("keys the entries by the prefixed phase names, keeping the values", () => {
    expect(screens).toEqual({ MOD_Tap: tapScreen, MOD_Reveal: revealScreen });
    expect(incomplete).toEqual({ MOD_Reveal: revealScreen });
  });

  it("keeps compile-time exhaustiveness over the prefixed phases", () => {
    // The result carries exactly the prefixed literal keys (no string index), so a game table
    // missing one of the module's local phases cannot satisfy its full phase record.
    const exactKeys: Expect<Equal<typeof screens, { MOD_Tap: Screen; MOD_Reveal: Screen }>> = true;
    const incompleteFailsFullTable: Expect<
      Equal<
        { Lobby: Screen } & typeof incomplete extends Record<KnownPhase, Screen> ? true : false,
        false
      >
    > = true;
    const completePassesFullTable: Expect<
      Equal<
        { Lobby: Screen } & typeof screens extends Record<KnownPhase, Screen> ? true : false,
        true
      >
    > = true;
    expect([exactKeys, incompleteFailsFullTable, completePassesFullTable]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("spreads into a game screen table that routes through AppRouter", () => {
    const table = {
      Lobby: { label: "Lobby", banner: "" },
      ...screens,
    };
    const client = connectedClient({ stateClass: BaseGameState, phase: "MOD_Tap" });
    const router = createAppRouter(client.manager, table);
    expect(router.screen).toEqual({ kind: "phase", phase: "MOD_Tap" });
    expect(table.MOD_Tap.label).toBe("Tap");
    client.state.phase = "MOD_Reveal";
    expect(router.screenKey).toBe("MOD_Reveal");
    expect(router.banner).toBe("RESULTS!");
  });
});
