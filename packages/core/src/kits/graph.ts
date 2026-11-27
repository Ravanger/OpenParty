import { required } from "../utils.js";

/**
 * A directed graph: each node id maps (by string key) to the ids of its outgoing edges; `NodeId`
 * narrows the edge ids for a game that names its nodes, and defaults to `string` for ids read from
 * content. An id with no entry is not a node; `validateGraph` reports it when an edge or a start
 * names it. Nothing here is game-specific.
 *
 * @experimental Phase kit API; may change before 1.0.
 */
export type Graph<NodeId extends string = string> = Readonly<Record<string, readonly NodeId[]>>;

/**
 * Every node a walk of `steps` edges from `from` can end on, plus the branch points it passes: nodes
 * with more than one outgoing edge, each listed once, in visit order. A node reached at `steps`
 * edges, or one with no outgoing edges, is an end; each node is listed at most once. Each node is
 * walked once per depth, so a node reached at two depths is walked twice — its outgoing edges
 * re-checked from each walk and a walk through a cycle keeps going until `steps` is reached.
 * `steps` of 0 returns `from` itself. Neither input is mutated.
 *
 * @experimental Phase kit API; may change before 1.0.
 * @throws {Error} when `from` is not a node — validate the content with {@link validateGraph} first.
 */
export function reachable<NodeId extends string>(
  graph: Graph<NodeId>,
  from: NodeId,
  steps: number,
): { ends: NodeId[]; branches: NodeId[] } {
  if (graph[from] === undefined) throw new Error(`Unknown node "${from}"`);
  if (steps <= 0) return { ends: [from], branches: [] };

  const ends: NodeId[] = [];
  const seenEnds = new Set<NodeId>();
  const branches: NodeId[] = [];
  const seenBranches = new Set<NodeId>();
  // A node is walked at most once per depth: a node reached at two depths by two walks is not
  // re-walked, but each walk must end and branch on its own. A walk that only leads back into a
  // cycle ends at the node its `steps`-th edge lands on.
  const visited = new Map<NodeId, Set<number>>([[from, new Set([0])]]);
  const queue: Array<{ node: NodeId; depth: number }> = [{ node: from, depth: 0 }];
  for (let i = 0; i < queue.length; ++i) {
    const { node, depth } = required(queue[i], "graph walk entry");
    const outgoing = graph[node] ?? [];
    if (depth >= steps || outgoing.length === 0) {
      if (!seenEnds.has(node)) {
        seenEnds.add(node);
        ends.push(node);
      }
      continue;
    }
    if (outgoing.length > 1 && !seenBranches.has(node)) {
      seenBranches.add(node);
      branches.push(node);
    }
    for (const next of outgoing) {
      const depths = visited.get(next);
      if (depths?.has(depth + 1)) continue;
      if (depths === undefined) visited.set(next, new Set([depth + 1]));
      else depths.add(depth + 1);
      queue.push({ node: next, depth: depth + 1 });
    }
  }
  return { ends, branches };
}

/**
 * The fewest-edge route from `from` to `to`, as the nodes it passes (both ends included), or
 * `undefined` when `to` cannot be reached — an unknown `from` counts as unreachable. Neither input is
 * mutated.
 *
 * @experimental Phase kit API; may change before 1.0.
 */
export function shortestPath<NodeId extends string>(
  graph: Graph<NodeId>,
  from: NodeId,
  to: NodeId,
): NodeId[] | undefined {
  if (graph[from] === undefined) return undefined;
  if (from === to) return [from];

  const parent = new Map<NodeId, NodeId>();
  const visited = new Set<NodeId>([from]);
  const queue: NodeId[] = [from];
  for (let i = 0; i < queue.length; ++i) {
    const node = required(queue[i], "graph walk node");
    for (const next of graph[node] ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      parent.set(next, node);
      if (next === to) {
        const path = [next];
        let current = node;
        while (current !== from) {
          path.push(current);
          current = required(parent.get(current), "path node");
        }
        path.push(from);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return undefined;
}

/**
 * Everything wrong with `graph` and its declared `starts`, in one list: an edge whose target is not
 * a node, an empty starts list, each start that is not a node, and each node reachable from none of
 * the starts (checked only when at least one start is a node). One or more starts are valid; an
 * empty list is not. Empty when the graph is valid.
 *
 * @experimental Phase kit API; may change before 1.0.
 */
export function validateGraph<NodeId extends string>(
  graph: Graph<NodeId>,
  starts: readonly NodeId[],
): string[] {
  const problems: string[] = [];
  const outgoingById = new Map<string, readonly NodeId[]>(Object.entries(graph));

  for (const [from, outgoing] of outgoingById) {
    for (const to of outgoing) {
      if (!outgoingById.has(to)) problems.push(`edge "${from}" -> "${to}": unknown node "${to}"`);
    }
  }

  if (starts.length === 0) problems.push("no start nodes");
  const knownStarts: string[] = [];
  for (const start of starts) {
    if (outgoingById.has(start)) knownStarts.push(start);
    else problems.push(`start "${start}": unknown node "${start}"`);
  }

  if (knownStarts.length > 0) {
    const reached = new Set<string>(knownStarts);
    const queue = [...knownStarts];
    for (let i = 0; i < queue.length; ++i) {
      const node = required(queue[i], "graph node");
      for (const next of outgoingById.get(node) ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    for (const id of outgoingById.keys()) {
      if (!reached.has(id)) problems.push(`node "${id}": not reachable from any start`);
    }
  }
  return problems;
}
