import { describe, expect, it } from "vitest";
import { assignTeams, teamTotals } from "../../src/kits/teams.js";
import { seedFromNumber, sfc32 } from "../../src/utils.js";

const rng = (seed: number): (() => number) => sfc32(seedFromNumber(seed));
const ids = ["a", "b", "c", "d"];

const soloOf = (teams: string[][]): string => {
  const solo = teams.find((team) => team.length === 1);
  expect(solo).toBeDefined();
  return solo?.[0] ?? "";
};

describe("assignTeams", () => {
  it("partitions ids into the requested sizes deterministically", () => {
    const teams = assignTeams(ids, [1, 3], rng(7));
    expect(teams).toEqual(assignTeams(ids, [1, 3], rng(7)));
    expect(teams.map((team) => team.length)).toEqual([1, 3]);
    expect(teams.flat().sort()).toEqual([...ids].sort());
  });

  it("gives different seeds different teams", () => {
    expect(assignTeams(ids, [2, 2], rng(2))).not.toEqual(assignTeams(ids, [2, 2], rng(7)));
  });

  it("never mutates the ids, the shape or earlier history", () => {
    const frozenIds = Object.freeze([...ids]);
    const shape = Object.freeze([1, 1, 2]);
    const history = Object.freeze(["a"]);
    const teams = assignTeams(frozenIds, shape, rng(7), history);
    expect(frozenIds).toEqual(ids);
    expect(shape).toEqual([1, 1, 2]);
    expect(history).toEqual(["a"]);
    expect(teams.flat().sort()).toEqual([...ids].sort());
  });

  it("rotates the solo seat across calls until every id has had it", () => {
    let history: string[] = [];
    const soloSeats = new Set<string>();
    for (let i = 0; i < ids.length; ++i) {
      const solo = soloOf(assignTeams(ids, [1, 3], rng(i + 1), history));
      expect(soloSeats.has(solo)).toBe(false);
      soloSeats.add(solo);
      history = [...history, solo];
    }
    expect(soloSeats).toEqual(new Set(ids));
  });

  it("reuses the least recently soloed id after a full rotation", () => {
    const teams = assignTeams(ids, [1, 3], rng(7), ["a", "b", "c", "d"]);
    expect(soloOf(teams)).toBe("a");
  });

  it("works without any solo seat", () => {
    expect(assignTeams(ids, [2, 2], rng(7)).map((team) => team.length)).toEqual([2, 2]);
  });

  it("partitions no ids into no teams", () => {
    expect(assignTeams([], [], rng(7))).toEqual([]);
  });

  it("rejects a shape whose sizes do not sum to the id count", () => {
    expect(() => assignTeams(ids, [1, 2], rng(7))).toThrow("needs 3 ids, got 4");
    expect(() => assignTeams(ids, [], rng(7))).toThrow("needs 0 ids, got 4");
  });

  it("rejects zero and non-integer sizes", () => {
    expect(() => assignTeams(ids, [0, 4], rng(7))).toThrow("positive integer sizes");
    expect(() => assignTeams(ids, [1.5, 2.5], rng(7))).toThrow("positive integer sizes");
  });
});

describe("teamTotals", () => {
  it("sums each team's scores", () => {
    expect(
      teamTotals({ a: 2, b: 3, c: 5, d: 7 }, [
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toEqual([5, 12]);
  });

  it("counts ids with no score as zero", () => {
    expect(teamTotals({ a: 2 }, [["a", "z"], []])).toEqual([2, 0]);
  });

  it("returns no totals for no teams", () => {
    expect(teamTotals({}, [])).toEqual([]);
  });

  it("never mutates its inputs", () => {
    const scores = Object.freeze({ a: 2, b: 3 });
    const teams = Object.freeze([Object.freeze(["a", "b"])]);
    expect(teamTotals(scores, teams)).toEqual([5]);
    expect(scores).toEqual({ a: 2, b: 3 });
    expect(teams).toEqual([["a", "b"]]);
  });
});
