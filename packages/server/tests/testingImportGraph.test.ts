import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const testingDir = join(here, "..", "src", "testing");

/** Every module specifier one source file imports (including side-effect and re-export forms). */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...source.matchAll(/\b(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
  ]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

/** The local dependency graph of the testing modules, keyed by file name without extension. */
function moduleGraph(): Map<string, string[]> {
  const files = readdirSync(testingDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.replace(/\.ts$/, ""));
  const graph = new Map<string, string[]>(files.map((name) => [name, []]));
  for (const name of files) {
    for (const specifier of specifiersOf(join(testingDir, `${name}.ts`))) {
      if (!specifier.startsWith("./")) continue;
      const target = specifier.slice(2).replace(/\.js$/, "");
      if (graph.has(target)) graph.get(name)?.push(target);
    }
  }
  return graph;
}

/** One cycle of the graph as a path back to its start, or undefined when it is acyclic. */
function findCycle(graph: Map<string, string[]>): string[] | undefined {
  const state = new Map<string, "active" | "done">();
  const stack: string[] = [];
  let cycle: string[] | undefined;
  const visit = (node: string): void => {
    if (cycle !== undefined) return;
    state.set(node, "active");
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === "active") {
        cycle = [...stack.slice(stack.indexOf(next)), next];
        return;
      }
      if (state.get(next) === undefined) visit(next);
    }
    stack.pop();
    state.set(node, "done");
  };
  for (const file of graph.keys()) {
    if (state.get(file) === undefined) visit(file);
    if (cycle !== undefined) break;
  }
  return cycle;
}

describe("testing module import graph", () => {
  it("is acyclic: the barrel re-exports the modules, none of them imports it back", () => {
    expect(findCycle(moduleGraph())).toBeUndefined();
  });
});
