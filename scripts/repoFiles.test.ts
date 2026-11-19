import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gitDiff, runGit } from "./git.js";
import { packageDirs, repoRoot, walkFiles } from "./repoFiles.js";

describe("repoRoot", () => {
  it("resolves to the repository root that contains scripts/ and package.json", () => {
    const root = repoRoot();
    expect(existsSync(join(root, "scripts", "repoFiles.ts"))).toBe(true);
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });

  it("ends with a path separator so callers can concatenate relative paths", () => {
    expect(repoRoot().endsWith("/")).toBe(true);
  });
});

describe("walkFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "walkfiles-"));

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists every file recursively and skips ignored entries whole", () => {
    writeFileSync(join(dir, "a.ts"), "");
    writeFileSync(join(dir, "coverage"), "");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "dep.js"), "");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "bundle.js"), "");
    mkdirSync(join(dir, "sub", "deep"), { recursive: true });
    writeFileSync(join(dir, "sub", "b.ts"), "");
    writeFileSync(join(dir, "sub", "deep", "c.css"), "");

    const all = walkFiles(dir).map((path) => relative(dir, path));
    expect(all.sort()).toEqual([
      "a.ts",
      "coverage",
      "dist/bundle.js",
      "node_modules/dep.js",
      "sub/b.ts",
      "sub/deep/c.css",
    ]);

    const filtered = walkFiles(dir, new Set(["node_modules", "dist", "coverage"])).map((path) =>
      relative(dir, path),
    );
    expect(filtered.sort()).toEqual(["a.ts", "sub/b.ts", "sub/deep/c.css"]);
  });

  it("returns nothing for an empty directory", () => {
    const empty = mkdtempSync(join(tmpdir(), "walkfiles-empty-"));
    try {
      expect(walkFiles(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("packageDirs", () => {
  it("lists the package directories under packages/ and games/", () => {
    expect(packageDirs("packages")).toContain("core");
    expect(packageDirs("packages")).toContain("server");
    expect(packageDirs("games")).toContain("wit-clash");
  });

  it("contains only directory names directly under the parent", () => {
    for (const name of packageDirs("packages")) {
      expect(statSync(join(repoRoot(), "packages", name)).isDirectory()).toBe(true);
    }
  });
});

describe("gitDiff", () => {
  it("runs `git diff` with the given arguments and returns the output", () => {
    const calls: string[][] = [];
    const exec = (args: string[]): string => {
      calls.push(args);
      return "diff-out";
    };
    expect(gitDiff(["--name-status", "origin/main...HEAD"], exec)).toBe("diff-out");
    expect(calls).toEqual([["diff", "--name-status", "origin/main...HEAD"]]);
  });

  it("shells out to the real git binary by default", () => {
    expect(runGit(["--version"])).toMatch(/^git version \d/);
  });
});
