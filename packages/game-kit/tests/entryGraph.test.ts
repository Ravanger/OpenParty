import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The built entry files. This test walks the import graph over `dist/` (what a deployable
 * `server.ts` actually evaluates), so `bun run build` must have run before the tests.
 */
const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

/** Every module specifier a built file imports: static `from` clauses and dynamic `import()` calls. */
const specifiersOf = (source: string): string[] =>
  [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1] as string);

const packageOf = (specifier: string): string | undefined =>
  specifier.startsWith("@openparty/") ? specifier.split("/").slice(0, 2).join("/") : undefined;

/**
 * The @openparty packages named in the import closure of one built entry file. Game-kit's own
 * files are walked; other packages are leaves (their dependency direction is pinned by
 * `check:boundaries`, and none of them reaches terminal, launcher or bots).
 */
const loadedPackages = (entryFile: string): Set<string> => {
  const entry = join(distDir, entryFile);
  expect(existsSync(entry), `missing ${entry} — run bun run build before the tests`).toBe(true);
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) break;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        queue.push(join(dirname(file), specifier));
      } else {
        const pkg = packageOf(specifier);
        if (pkg !== undefined) packages.add(pkg);
      }
    }
  }
  return packages;
};

const absent = (loaded: Set<string>, entryFile: string, ...forbidden: string[]): void => {
  for (const pkg of forbidden)
    expect(loaded.has(pkg), `${entryFile} must not load ${pkg}`).toBe(false);
};

describe("entry module graphs (built files)", () => {
  it("the serve entry loads no terminal, launcher or bots module", () => {
    const loaded = loadedPackages("serve.js");
    absent(loaded, "serve.js", "@openparty/terminal", "@openparty/launcher", "@openparty/bots");
    expect(loaded.has("@openparty/server"), "serve.js must keep its lazy server starter").toBe(
      true,
    );
  });

  it("the launch entry loads the launcher and no terminal module", () => {
    // It may load @openparty/bots: buildLaunchConfig builds the demo tables from DemoTable.
    const loaded = loadedPackages("launch.js");
    absent(loaded, "launch.js", "@openparty/terminal");
    expect(loaded.has("@openparty/launcher"), "launch.js must load the launcher").toBe(true);
  });

  it("the play entry loads the terminal and no bots module", () => {
    const loaded = loadedPackages("play.js");
    absent(loaded, "play.js", "@openparty/bots");
    expect(loaded.has("@openparty/terminal"), "play.js must load the terminal").toBe(true);
  });

  it("the bots and demo entries load the terminal and no launcher module", () => {
    // The demo entry may load @openparty/bots: it reuses buildLaunchConfig's demo bot options.
    for (const entry of ["botsCli.js", "demoCli.js"]) {
      const loaded = loadedPackages(entry);
      absent(loaded, entry, "@openparty/launcher");
      expect(loaded.has("@openparty/terminal"), `${entry} must load the terminal`).toBe(true);
    }
  });
});
