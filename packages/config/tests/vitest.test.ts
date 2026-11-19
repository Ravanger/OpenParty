import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ViteUserConfig } from "vitest/config";
import { nodeTestConfig, sourceAliases, uiTestConfig } from "../src/vitest.js";

function pluginNames(plugins: readonly unknown[] | undefined): string[] {
  return (plugins ?? []).flatMap((p) => {
    if (Array.isArray(p)) return pluginNames(p);
    if (typeof p === "object" && p !== null && "name" in p && typeof p.name === "string")
      return [p.name];
    return [];
  });
}

const base = { name: "demo", coverage: ["src/**/*.ts"] };

describe("uiTestConfig", () => {
  it("sets up jsdom with svelte", () => {
    const config = uiTestConfig(base);
    expect(pluginNames(config.plugins)).toContain("vite-plugin-svelte");
    expect(config.resolve?.conditions).toEqual(["browser"]);
    expect(config.test?.name).toBe("demo");
    expect(config.test?.environment).toBe("jsdom");
    expect(config.test?.globals).toBe(true);
    expect(config.test?.fileParallelism).toBe(false);
  });

  it("defaults include, exclude, coverage and setupFiles", () => {
    const config = uiTestConfig(base);
    expect(config.test?.include).toEqual(["tests/**/*.test.ts"]);
    expect(config.test?.exclude).toEqual(["dist/**", "node_modules/**", "coverage/**"]);
    expect(config.test?.coverage?.include).toEqual(["src/**/*.ts"]);
    expect(config.test?.setupFiles).toEqual([
      "@testing-library/jest-dom/vitest",
      "@openparty/game-client/test-setup",
    ]);
  });

  it("takes include, extra excludes and replaces setupFiles", () => {
    const config = uiTestConfig({
      ...base,
      include: ["a/**/*.test.ts"],
      exclude: ["tests/game/**"],
      setupFiles: ["./setup.ts"],
    });
    expect(config.test?.include).toEqual(["a/**/*.test.ts"]);
    expect(config.test?.exclude).toEqual([
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "tests/game/**",
    ]);
    expect(config.test?.setupFiles).toEqual(["./setup.ts"]);
  });

  it("merges overrides last", () => {
    const config = uiTestConfig({
      ...base,
      overrides: { test: { fileParallelism: true, testTimeout: 1 } },
    });
    expect(config.test?.fileParallelism).toBe(true);
    expect(config.test?.testTimeout).toBe(1);
    expect(config.test?.environment).toBe("jsdom");
  });
});

describe("nodeTestConfig", () => {
  it("sets up the node environment, compiling Svelte sources like the UI projects", () => {
    const config = nodeTestConfig(base);
    // The shared preset aliases @openparty/* to source, so node tests can load a package's
    // .svelte.ts files (e.g. GameConnectionManager via game-client/testing). They must be
    // compiled with the same svelte transform as the UI projects: v8 coverage merges maps per
    // source location, and a plain-TS transform leaves phantom uncovered statements behind.
    expect(pluginNames(config.plugins)).toContain("vite-plugin-svelte");
    expect(config.test?.name).toBe("demo");
    expect(config.test?.environment).toBe("node");
    expect(config.test?.fileParallelism).toBe(false);
    expect(config.test?.include).toEqual(["tests/**/*.test.ts"]);
    expect(config.test?.exclude).toEqual(["dist/**", "node_modules/**", "coverage/**"]);
    expect(config.test?.coverage?.include).toEqual(["src/**/*.ts"]);
  });

  it("defaults setupFiles to the node WebSocket polyfill, replaced when given", () => {
    expect(nodeTestConfig(base).test?.setupFiles).toEqual(["@openparty/config/node-test-setup"]);
    expect(nodeTestConfig({ ...base, setupFiles: ["./s.ts"] }).test?.setupFiles).toEqual([
      "./s.ts",
    ]);
  });

  it("takes include and extra excludes", () => {
    const config = nodeTestConfig({ ...base, include: ["x/**"], exclude: ["y/**"] });
    expect(config.test?.include).toEqual(["x/**"]);
    expect(config.test?.exclude).toEqual(["dist/**", "node_modules/**", "coverage/**", "y/**"]);
  });

  it("merges overrides last", () => {
    const config = nodeTestConfig({
      ...base,
      overrides: { test: { fileParallelism: true, server: { deps: { inline: ["z"] } } } },
    });
    expect(config.test?.fileParallelism).toBe(true);
    expect(config.test?.server?.deps?.inline).toEqual(["z"]);
    expect(config.test?.environment).toBe("node");
  });
});

/**
 * Every `@openparty/*` export subpath, mapped to the source file the shared preset must alias it
 * to (relative to `packages/`). Adding an exported subpath to any package means adding its line
 * here: tests run against source so a new dist-only entry would silently test stale code.
 */
const EXPECTED_SOURCE_ALIASES: Record<string, string> = {
  "@openparty/bots": "bots/src/index.ts",
  "@openparty/client-utils": "client-utils/src/index.ts",
  "@openparty/config/node-test-setup": "config/node-test-setup.ts",
  "@openparty/config/svelte": "config/src/svelte.ts",
  "@openparty/config/vite": "config/src/vite.ts",
  "@openparty/config/vitest": "config/src/vitest.ts",
  "@openparty/content": "content/src/index.ts",
  "@openparty/content/filter": "content/src/filter.ts",
  "@openparty/core": "core/src/index.ts",
  "@openparty/core/awards": "core/src/awards/index.ts",
  "@openparty/core/kits": "core/src/kits/index.ts",
  "@openparty/core/replay": "core/src/replay/index.ts",
  "@openparty/core/testing": "core/src/testing/index.ts",
  "@openparty/game-client": "game-client/src/index.ts",
  "@openparty/game-client/test-setup": "game-client/test-setup.ts",
  "@openparty/game-client/testing": "game-client/src/testing.ts",
  "@openparty/game-kit": "game-kit/src/index.ts",
  "@openparty/game-kit/bots": "game-kit/src/botsCli.ts",
  "@openparty/game-kit/demo": "game-kit/src/demoCli.ts",
  "@openparty/game-kit/launch": "game-kit/src/launch.ts",
  "@openparty/game-kit/play": "game-kit/src/play.ts",
  "@openparty/game-kit/serve": "game-kit/src/serve.ts",
  "@openparty/game-ui": "game-ui/src/index.ts",
  "@openparty/game-ui/components": "game-ui/src/components/index.ts",
  "@openparty/game-ui/testing": "game-ui/testing.ts",
  "@openparty/launcher": "launcher/src/index.ts",
  "@openparty/server": "server/src/index.ts",
  "@openparty/server/bun": "server/src/bun.ts",
  "@openparty/server/node": "server/src/node.ts",
  "@openparty/server/probe": "server/src/probe.ts",
  "@openparty/server/testing": "server/src/testing/index.ts",
  "@openparty/shared": "shared/src/index.ts",
  "@openparty/shared/schema": "shared/src/schema/index.ts",
  "@openparty/terminal": "terminal/src/index.ts",
  "@openparty/terminal/testing": "terminal/src/testing.ts",
};

const packagesDir = new URL("../..", import.meta.url); // packages/

function aliasesOf(config: ViteUserConfig): Record<string, string> {
  expect(config.resolve?.alias).toBeTypeOf("object");
  return config.resolve?.alias as Record<string, string>;
}

/** Subpaths the UI preset resolves to dist instead of source, and their package-relative dist targets. */
const JSDOM_DIST_ONLY: Record<string, string> = {
  "@openparty/server/node": "server/dist/node.js",
  "@openparty/server/probe": "server/dist/probe.js",
  "@openparty/server/testing": "server/dist/testing/index.js",
};

function expectedAliases(overrides: Record<string, string> = {}): Record<string, string> {
  const expected: Record<string, string> = {};
  for (const [specifier, relative] of Object.entries(EXPECTED_SOURCE_ALIASES)) {
    expected[specifier] = fileURLToPath(new URL(relative, packagesDir));
  }
  for (const [specifier, relative] of Object.entries(overrides)) {
    expected[specifier] = fileURLToPath(new URL(relative, packagesDir));
  }
  return expected;
}

describe("source aliases (stale-dist trap)", () => {
  it("maps every @openparty/* export subpath to package source in the node preset", () => {
    expect(aliasesOf(nodeTestConfig(base))).toEqual(expectedAliases());
  });

  it("keeps source aliases in the UI preset except node-runtime subpaths, which resolve to dist", () => {
    // jsdom transforms modules with Vite's client pipeline: value imports of node: builtins
    // become CJS interop whose remapped v8 coverage items don't line up with the
    // SSR-transformed ones from node projects (the provider merges per-project maps by source
    // location), leaving phantom uncovered statements. UI tests resolve those subpaths to dist;
    // the owning project's own tests cover the source. Adding a subpath whose source graph
    // value-imports a node: builtin means adding it here and to JSDOM_DIST_ONLY in src/vitest.ts,
    // unless no node project imports it and the package has no dist build (game-ui/testing), in
    // which case it stays aliased to source.
    expect(aliasesOf(uiTestConfig(base))).toEqual(expectedAliases(JSDOM_DIST_ONLY));
  });

  it("orders subpath aliases before their parent so prefix matching picks the specific one", () => {
    const keys = Object.keys(aliasesOf(nodeTestConfig(base)));
    // A stable sort by descending length is a no-op exactly when the keys are already ordered.
    expect(keys).toEqual([...keys].sort((a, b) => b.length - a.length));
  });

  it("points only at files that exist and are not in dist", () => {
    for (const target of Object.values(aliasesOf(nodeTestConfig(base)))) {
      expect(target).not.toContain("/dist/");
      expect(existsSync(target)).toBe(true);
    }
  });
});

describe("sourceAliases", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "openparty-aliases-"));

  afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

  it("skips non-packages and non-@openparty packages; aliases only code exports", () => {
    const write = (relative: string, content: string): void => {
      const path = join(fixtureDir, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    };
    // A plain file and a manifest-less directory are not packages.
    write("plain-file.txt", "nope");
    mkdirSync(join(fixtureDir, "empty-dir"), { recursive: true });
    // Not a package: missing name, or a name outside the workspace scope.
    write("no-name/package.json", "{}");
    write(
      "other-pkg/package.json",
      JSON.stringify({ name: "some-other/pkg", exports: { ".": "./dist/index.js" } }),
    );
    // A package without an exports field aliases nothing.
    write("no-exports/package.json", JSON.stringify({ name: "@openparty/no-exports" }));
    // The fixture package: one alias per code export, subpath and root.
    write(
      "fixture/package.json",
      JSON.stringify({
        name: "@openparty/fixture",
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./extra": { default: "./dist/extra.js" },
          "./src-file": "./src-file.ts",
          "./data": "./data.json",
          "./types-only": { types: "./dist/types-only.d.ts" },
        },
      }),
    );

    expect(sourceAliases(fixtureDir)).toEqual({
      "@openparty/fixture/src-file": join(fixtureDir, "fixture", "src-file.ts"),
      "@openparty/fixture/extra": join(fixtureDir, "fixture", "src", "extra.ts"),
      "@openparty/fixture": join(fixtureDir, "fixture", "src", "index.ts"),
    });
  });
});
