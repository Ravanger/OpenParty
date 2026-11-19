import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { checkBoundaries, importsOf, type SourceFile, type Workspace } from "./checkBoundaries.js";
import { packageDirs, repoRoot, walkFiles } from "./repoFiles.js";

const root = repoRoot();
const SOURCE_DIRS = ["src", "tests", "ui", "bots", "terminal", "scripts"];
const SOURCE = /\.(ts|svelte)$/;
const SKIPPED = new Set(["node_modules", "dist", "coverage"]);

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const names = (record: unknown): string[] =>
  typeof record === "object" && record !== null ? Object.keys(record) : [];

const readWorkspace = (dir: string): Workspace | undefined => {
  let manifest: {
    name?: string;
    dependencies?: unknown;
    devDependencies?: unknown;
    exports?: unknown;
  };
  try {
    manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
  const rootFiles = readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && SOURCE.test(entry.name))
    .map((entry) => join(root, dir, entry.name));
  const files: SourceFile[] = SOURCE_DIRS.map((sub) => join(root, dir, sub))
    .filter(isDirectory)
    .flatMap((sub) => walkFiles(sub, SKIPPED).filter((path) => SOURCE.test(basename(path))))
    .concat(rootFiles)
    .map((path) => ({
      path: relative(root, path).replaceAll("\\", "/"),
      imports: importsOf(readFileSync(path, "utf8")),
    }));
  return {
    dir,
    name: manifest.name ?? dir,
    dependencies: names(manifest.dependencies),
    devDependencies: names(manifest.devDependencies),
    exports: names(manifest.exports),
    files,
  };
};

const workspaces = ["packages", "games"]
  .flatMap((parent) => packageDirs(parent).map((name) => readWorkspace(`${parent}/${name}`)))
  .filter((workspace): workspace is Workspace => workspace !== undefined);

const violations = checkBoundaries(workspaces);
for (const violation of violations) {
  console.error(`${violation.path}: ${violation.rule}: ${violation.detail}`);
}
process.exit(violations.length === 0 ? 0 : 1);
