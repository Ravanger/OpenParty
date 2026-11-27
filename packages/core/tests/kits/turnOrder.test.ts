import { describe, expect, it } from "vitest";
import { createTurnOrder, nextTurn } from "../../src/kits/turnOrder.js";
import { seedFromNumber, sfc32 } from "../../src/utils.js";

const rng = (seed: number): (() => number) => sfc32(seedFromNumber(seed));

describe("createTurnOrder", () => {
  it("shuffles ids reproducibly from the seed", () => {
    expect(createTurnOrder(["a", "b", "c", "d"], rng(7))).toEqual(["c", "d", "b", "a"]);
    expect(createTurnOrder(["a", "b", "c", "d"], rng(7))).toEqual(
      createTurnOrder(["a", "b", "c", "d"], rng(7)),
    );
  });

  it("uses the rng rather than returning the input order", () => {
    expect(createTurnOrder(["a", "b", "c", "d"], rng(2))).not.toEqual(
      createTurnOrder(["a", "b", "c", "d"], rng(7)),
    );
  });

  it("never mutates the input and returns a fresh array", () => {
    const ids = Object.freeze(["a", "b", "c", "d"]);
    const order = createTurnOrder(ids, rng(7));
    expect(ids).toEqual(["a", "b", "c", "d"]);
    expect(order).not.toBe(ids);
    expect([...order].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty order for no ids", () => {
    expect(createTurnOrder([], rng(7))).toEqual([]);
  });
});

describe("nextTurn", () => {
  const order = ["a", "b", "c", "d"];

  it("takes the next present id after the current one", () => {
    expect(nextTurn(order, "a", new Set(order))).toBe("b");
  });

  it("does not restart from the first id when the current one is in the middle", () => {
    expect(nextTurn(order, "b", new Set(["a", "c", "d"]))).toBe("c");
  });

  it("skips absent ids", () => {
    expect(nextTurn(order, "a", new Set(["a", "c", "d"]))).toBe("c");
  });

  it("wraps around at the end of the order", () => {
    expect(nextTurn(order, "d", new Set(order))).toBe("a");
  });

  it("starts from the first id when current is missing or not in the order", () => {
    expect(nextTurn(order, undefined, new Set(order))).toBe("a");
    expect(nextTurn(order, "z", new Set(order))).toBe("a");
  });

  it("returns the current id when it is the only one present", () => {
    expect(nextTurn(order, "c", new Set(["c"]))).toBe("c");
  });

  it("returns undefined when nobody in the order is present", () => {
    expect(nextTurn(order, "b", new Set(["z"]))).toBeUndefined();
  });

  it("returns undefined with an empty order or no present ids", () => {
    expect(nextTurn([], "a", new Set(["a"]))).toBeUndefined();
    expect(nextTurn(order, "a", new Set())).toBeUndefined();
  });
});
