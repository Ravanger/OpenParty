import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root (the parent of `scripts/`), resolved from this file's own location; ends with a path separator on POSIX. */
export const repoRoot = (): string => fileURLToPath(new URL("..", import.meta.url));

/** Every file under `dir`, recursively, in directory-listing order; entries named in `ignore` are skipped whole, whatever their type. */
export const walkFiles = (dir: string, ignore: ReadonlySet<string> = new Set()): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignore.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(path, ignore) : [path];
  });

/** The names of the directories directly under `repoRoot()/parent`, in directory-listing order. */
export const packageDirs = (parent: string): string[] =>
  readdirSync(join(repoRoot(), parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
