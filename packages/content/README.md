# @openparty/content

Content tooling for games: parse commented-JSON (`.json`/`.jsonc`) content folders and validate them against a Zod schema; filter free text (answers, player names) against an English profanity dataset. Game-agnostic — the schemas and vocabulary stay in the game.

## Exports

| Subpath | What |
|---|---|
| `@openparty/content` | `stripJsonComments`, `loadJsoncFile`, `loadJsoncDir`, `loadJsoncDirWithFiles`, `contentDirFrom` |
| `@openparty/content/filter` | `TextFilter`, `FilterLevel`, `FilterResult`, `createTextFilter` |

```ts
import { loadJsoncDir } from "@openparty/content";
import { z } from "zod";

const Item = z.object({ id: z.string(), n: z.number() });

// Every .json/.jsonc file in the folder, name order, validated; duplicate ids throw.
const items = await loadJsoncDir("./content/items", Item, { idOf: (item) => item.id, label: "Item" });
```

- `stripJsonComments(input)` removes `//` and `/* */` comments without touching comment-like sequences inside string literals.
- `contentDirFrom(override, entryUrl, relative)` — a game entry's content directory: the `override` when set (an empty string counts as set, `??` semantics), else the absolute folder `relative` next to `entryUrl` (the entry file's `import.meta.url`).
- `loadJsoncDir(dir, schema, { idOf, label, onInvalid?, maxFiles?, maxFileBytes? })` (options type `LoadJsoncDirOptions`: how items are identified, labelled and validated) loads every regular `.json`/`.jsonc` file in `dir` (name order; symlinks and subdirectories are ignored), parses it with `schema`, and refuses duplicate ids. A missing directory throws.
- `loadJsoncDirWithFiles(dir, schema, options)` is the same loader but returns `{ file, value }` per item, so a caller can name the source file in its own errors (e.g. cross-file checks). It calls `loadJsoncFile` per file; an oversized file still throws even with `onInvalid: "skip"`.
- `loadJsoncFile(file, schema, { label, maxFileBytes? })` (options type `LoadJsoncFileOptions`) loads one JSONC file with the same parsing, validation and messages as `loadJsoncDir`: it returns the validated value, and a missing file, a file above `maxFileBytes`, invalid JSON or a schema failure throws, each naming the file.
- Fail loudly by default: an unparsable file or a schema failure throws, naming the file (and the failing entry for schema errors). Pass `onInvalid: "skip"` to skip such files with a `console.warn` instead.
- Caps: more than `maxFiles` files (default 256) or a file above `maxFileBytes` bytes (default 1 MiB) throws.

## Graph content

A track or board is content like any other: describe it in a JSONC file, validate it with the game's own zod schema, and hand the adjacency to the graph helpers in `@openparty/core/kits` (`@experimental`; see the framework guide's Graph helpers). `@openparty/content` only loads the file — the schema and vocabulary stay in the game.

```ts
import { loadJsoncDir } from "@openparty/content";
import { type Graph, validateGraph } from "@openparty/core/kits";
import { z } from "zod";

const BoardSchema = z.object({
  id: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      layout: z.object({ column: z.number().int(), row: z.number().int() }).optional(),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
  start: z.string(),
});
type Board = z.infer<typeof BoardSchema>;

function toGraph(board: Board): Graph {
  const graph: Record<string, string[]> = Object.fromEntries(
    board.nodes.map((node) => [node.id, []]),
  );
  for (const edge of board.edges) {
    const outgoing = graph[edge.from] ?? [];
    graph[edge.from] = outgoing;
    outgoing.push(edge.to);
  }
  return graph;
}

const boards = await loadJsoncDir("./content/boards", BoardSchema, {
  idOf: (board) => board.id,
  label: "Board",
});
for (const board of boards) {
  const problems = validateGraph(toGraph(board), [board.start]);
  if (problems.length > 0) throw new Error(`${board.id}: ${problems.join("; ")}`);
}
```

`toGraph` keeps an edge whose target no node declares, so `validateGraph` reports it instead of the loader silently dropping it. `layout` is the game's to read when rendering; the graph helpers ignore it. Several starts are allowed (`starts` is a list); an empty list is a problem.

## Text filtering

`createTextFilter()` returns the default English `TextFilter`, backed by the [obscenity](https://github.com/jo3-l/obscenity) dataset and its recommended transformers (case folding, confusables, leet-speak such as `$` for `s`, repeated-letter collapse). Matchers are built lazily on first use.

```ts
import { createTextFilter } from "@openparty/content/filter";

const filter = createTextFilter();
filter.check("hello world", "moderate"); // { ok: true }
filter.check("what the $hit", "moderate"); // { ok: false, reason: "contains inappropriate language" }
```

Levels (`FilterLevel`):

- `off` — everything passes.
- `moderate` — slurs and profanity fail; mild terms (e.g. `ass`, `bastard`, `boob`) pass.
- `strict` — the full dataset fails, mild terms included.

On rejection the `reason` is a short fixed string per level (`"contains inappropriate language"` at moderate, `"contains strong language"` at strict); it never contains the matched word, so it is safe to show to players. The filter lives on its own subpath so consumers that only load content files do not pull the dataset in.
