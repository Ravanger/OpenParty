import { MAX_OPTIONS_JSON_LENGTH } from "@openparty/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveGameOptions } from "../../src/index.js";

const RoundsSchema = z.object({ rounds: z.number() });
const DataSchema = z.object({ data: z.string() });

describe("resolveGameOptions", () => {
  it("parses raw options against the game's schema", () => {
    expect(resolveGameOptions({ options: RoundsSchema }, { rounds: 5 })).toEqual({
      ok: true,
      options: { rounds: 5 },
    });
  });

  it("returns 'invalid' for a schema failure without leaking Zod text", () => {
    expect(resolveGameOptions({ options: RoundsSchema }, { rounds: "many" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("returns 'too-large' when the parsed JSON exceeds MAX_OPTIONS_JSON_LENGTH", () => {
    expect(
      resolveGameOptions({ options: DataSchema }, { data: "x".repeat(MAX_OPTIONS_JSON_LENGTH) }),
    ).toEqual({ ok: false, reason: "too-large" });
  });

  it("accepts a parse result whose JSON is exactly MAX_OPTIONS_JSON_LENGTH", () => {
    const filler = "x".repeat(MAX_OPTIONS_JSON_LENGTH - JSON.stringify({ data: "" }).length);
    expect(resolveGameOptions({ options: DataSchema }, { data: filler })).toEqual({
      ok: true,
      options: { data: filler },
    });
  });

  it("accepts empty raw options when the game declares no schema", () => {
    expect(resolveGameOptions({}, {})).toEqual({ ok: true, options: {} });
  });

  it("returns 'unexpected' when a schema-less game is given keys", () => {
    expect(resolveGameOptions({}, { rounds: 5 })).toEqual({ ok: false, reason: "unexpected" });
  });
});
