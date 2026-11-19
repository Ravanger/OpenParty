import { describe, expect, it } from "vitest";
import { answerAuthor } from "../../src/round.js";
import { makeCtx, seat } from "./ctxFixture.js";

describe("answerAuthor", () => {
  it("returns the recorded author of an answer", () => {
    const { ctx } = makeCtx([seat("p1")]);
    ctx.priv.authors.set("a1", "p1");
    expect(answerAuthor(ctx, "a1")).toBe("p1");
  });

  it("throws for an answer without a recorded author", () => {
    const { ctx } = makeCtx([]);
    expect(() => answerAuthor(ctx, "missing")).toThrow("Missing answer author");
  });
});
