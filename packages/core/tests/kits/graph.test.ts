import { describe, expect, it } from "vitest";
import { type Graph, reachable, shortestPath, validateGraph } from "../../src/kits/graph.js";

const linear: Graph = { start: ["middle"], middle: ["end"], end: [] };

describe("reachable", () => {
  it("walks a linear track and stops after the step count", () => {
    expect(reachable(linear, "start", 2)).toEqual({ ends: ["end"], branches: [] });
  });

  it("ends at a sink when the step count runs past it", () => {
    expect(reachable(linear, "start", 5)).toEqual({ ends: ["end"], branches: [] });
  });

  it("returns the start itself for zero steps", () => {
    expect(reachable(linear, "start", 0)).toEqual({ ends: ["start"], branches: [] });
  });

  it("reports a branch point once when its branches rejoin", () => {
    const graph: Graph = { a: ["b", "c"], b: ["d"], c: ["d"], d: [] };
    expect(reachable(graph, "a", 2)).toEqual({ ends: ["d"], branches: ["a"] });
  });

  it("reports every branch point passed, once each", () => {
    const graph: Graph = {
      a: ["b", "c"],
      b: ["d", "e"],
      c: ["f"],
      d: ["z"],
      e: ["z"],
      f: ["z"],
      z: [],
    };
    expect(reachable(graph, "a", 3)).toEqual({ ends: ["z"], branches: ["a", "b"] });
  });

  it("terminates on a cycle and reports no end", () => {
    const graph: Graph = { a: ["b"], b: ["c"], c: ["a"] };
    expect(reachable(graph, "a", 100)).toEqual({ ends: [], branches: [] });
  });

  it("reports a branch inside a cycle once", () => {
    const graph: Graph = { a: ["b", "c"], b: ["a"], c: ["a"] };
    expect(reachable(graph, "a", 50)).toEqual({ ends: [], branches: ["a"] });
  });

  it("treats an edge to a node without an entry as a sink", () => {
    const graph: Graph = { a: ["z"] };
    expect(reachable(graph, "a", 2)).toEqual({ ends: ["z"], branches: [] });
  });

  it("throws for an unknown start node", () => {
    expect(() => reachable(linear, "missing", 1)).toThrow('Unknown node "missing"');
  });

  it("does not mutate the graph", () => {
    const graph: Graph = Object.freeze({ a: Object.freeze(["b"]), b: Object.freeze([]) });
    reachable(graph, "a", 1);
    expect(graph).toEqual({ a: ["b"], b: [] });
  });
});

describe("shortestPath", () => {
  it("returns every node from the start to the target", () => {
    expect(shortestPath(linear, "start", "end")).toEqual(["start", "middle", "end"]);
  });

  it("takes the shorter of two routes", () => {
    const branched: Graph = {
      start: ["far", "near"],
      far: ["far2"],
      far2: ["end"],
      near: ["end"],
      end: [],
    };
    expect(shortestPath(branched, "start", "end")).toEqual(["start", "near", "end"]);
  });

  it("does not revisit a node both branches lead to", () => {
    const graph: Graph = { a: ["b", "c"], b: ["d"], c: ["d"], d: ["e"], e: [] };
    expect(shortestPath(graph, "a", "e")).toEqual(["a", "b", "d", "e"]);
  });

  it("returns just the start when it is also the target", () => {
    expect(shortestPath(linear, "middle", "middle")).toEqual(["middle"]);
  });

  it("returns undefined when the target is unreachable", () => {
    expect(shortestPath(linear, "start", "elsewhere")).toBeUndefined();
    expect(
      shortestPath({ start: ["middle"], middle: [], island: [] }, "start", "island"),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown start", () => {
    expect(shortestPath(linear, "missing", "end")).toBeUndefined();
    expect(shortestPath(linear, "missing", "missing")).toBeUndefined();
  });

  it("returns undefined when the target is only an unknown edge endpoint", () => {
    expect(shortestPath({ start: ["nowhere"] }, "start", "missing")).toBeUndefined();
  });

  it("reaches an unknown edge endpoint as the target", () => {
    expect(shortestPath({ start: ["nowhere"] }, "start", "nowhere")).toEqual(["start", "nowhere"]);
  });
});

describe("validateGraph", () => {
  it("accepts a valid graph", () => {
    expect(validateGraph({ start: ["middle"], middle: [] }, ["start"])).toEqual([]);
  });

  it("accepts a cycle", () => {
    expect(validateGraph({ a: ["b"], b: ["a"] }, ["a"])).toEqual([]);
  });

  it("accepts several starts and a node reachable only from the second", () => {
    expect(validateGraph({ first: [], second: ["tail"], tail: [] }, ["first", "second"])).toEqual(
      [],
    );
  });

  it("reports an empty starts list", () => {
    expect(validateGraph({ start: [] }, [])).toEqual(["no start nodes"]);
  });

  it("reports a start that is not a node", () => {
    expect(validateGraph({ start: [] }, ["missing"])).toEqual([
      'start "missing": unknown node "missing"',
    ]);
  });

  it("reports an edge with an unknown endpoint", () => {
    expect(validateGraph({ start: ["nowhere"] }, ["start"])).toEqual([
      'edge "start" -> "nowhere": unknown node "nowhere"',
    ]);
  });

  it("reports a node reachable from none of the starts", () => {
    expect(validateGraph({ start: ["tail"], tail: [], island: [] }, ["start"])).toEqual([
      'node "island": not reachable from any start',
    ]);
  });

  it("reports every problem in one call", () => {
    expect(
      validateGraph({ start: ["nowhere"], second: ["elsewhere"], island: [] }, ["missing"]),
    ).toEqual([
      'edge "start" -> "nowhere": unknown node "nowhere"',
      'edge "second" -> "elsewhere": unknown node "elsewhere"',
      'start "missing": unknown node "missing"',
    ]);
  });

  it("reports an unreachable node alongside other problems", () => {
    expect(validateGraph({ start: ["nowhere"], island: [] }, ["start"])).toEqual([
      'edge "start" -> "nowhere": unknown node "nowhere"',
      'node "island": not reachable from any start',
    ]);
  });

  it("reports every start that is not a node", () => {
    expect(validateGraph({ start: [] }, ["one", "two"])).toEqual([
      'start "one": unknown node "one"',
      'start "two": unknown node "two"',
    ]);
  });

  it("reports an empty graph with a start", () => {
    expect(validateGraph({}, ["start"])).toEqual(['start "start": unknown node "start"']);
  });
});
