import { describe, expect, it } from "vitest";
import { createWitClashGame } from "../../src/game.js";
import { makeCategories, Table } from "./support.js";

/** A Prompting whose duration stops equalling the prompt option, so the two formulas disagree. */
const divergentPrompting = () => {
  const definition = createWitClashGame({ categories: makeCategories() });
  definition.phases.Prompting = { ...definition.phases.Prompting, duration: 45_000 };
  return new Table({ definition });
};

describe("SUBMIT_ANSWER submit times", () => {
  it("measures the submit from the phase's real start, not the prompt option", () => {
    const t = divergentPrompting();
    t.toPrompting();
    expect(t.state.phaseDurationMs).toBe(45_000); // published duration; the option still says 90 s
    t.tick(10_000);
    const matchupId = t.mine("p1").prompts[0]?.matchupId as string;
    t.act("p1", "SUBMIT_ANSWER", { matchupId, answer: "a" });
    expect(t.priv.submitTimes.get("p1")?.get(matchupId)).toBe(10_000);
  });

  it("measures the submit from the phase start while duration and option agree", () => {
    const t = new Table();
    t.toPrompting();
    t.tick(25_000);
    const matchupId = t.mine("p1").prompts[0]?.matchupId as string;
    t.act("p1", "SUBMIT_ANSWER", { matchupId, answer: "a" });
    expect(t.priv.submitTimes.get("p1")?.get(matchupId)).toBe(25_000);
  });
});
