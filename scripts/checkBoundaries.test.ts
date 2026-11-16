import { describe, expect, it } from "vitest";
import { checkBoundaries, importsOf, type SourceFile, type Workspace } from "./checkBoundaries.js";

const workspace = (name: string, overrides: Partial<Workspace> = {}): Workspace => ({
  dir: `packages/${name}`,
  name: `@openparty/${name}`,
  dependencies: [],
  devDependencies: [],
  exports: ["."],
  files: [],
  ...overrides,
});

const file = (path: string, ...imports: string[]): SourceFile => ({ path, imports });

const base = (): Workspace[] => [
  workspace("shared"),
  workspace("core", { dependencies: ["@openparty/shared"] }),
  workspace("server", {
    dependencies: ["@openparty/core", "@openparty/shared"],
    exports: [".", "./node"],
  }),
  workspace("game-client", { dependencies: ["@openparty/shared"] }),
  workspace("game-ui", {
    dependencies: ["@openparty/game-client", "@openparty/shared"],
    exports: [".", "./components"],
  }),
  workspace("bots", { dependencies: ["@openparty/shared"] }),
  workspace("config", { exports: ["./vitest"] }),
  workspace("cli"),
];

const withChange = (name: string, overrides: Partial<Workspace>): Workspace[] =>
  base().map((entry) => (entry.name === `@openparty/${name}` ? { ...entry, ...overrides } : entry));

const game = (overrides: Partial<Workspace> = {}): Workspace => ({
  dir: "games/demo",
  name: "@openparty/demo",
  dependencies: ["@openparty/game-ui", "@openparty/game-client", "@openparty/shared"],
  devDependencies: [],
  exports: [],
  files: [],
  ...overrides,
});

const rules = (workspaces: Workspace[]): string[] =>
  checkBoundaries(workspaces).map((violation) => violation.rule);

describe("importsOf", () => {
  it("finds from, side-effect and dynamic imports, and re-exports", () => {
    const source = [
      `import { a } from "alpha";`,
      `import 'beta';`,
      `const c = await import("gamma");`,
      `export * from './delta.js';`,
      `import {\n  e,\n} from "epsilon";`,
    ].join("\n");
    expect(importsOf(source)).toEqual(["alpha", "beta", "gamma", "./delta.js", "epsilon"]);
  });

  it("finds require and import.meta.glob references", () => {
    const source = [
      `const a = require("@colyseus/core");`,
      `const b = import.meta.glob("../src/*");`,
      `const c = import.meta.globEager('../x/*');`,
    ].join("\n");
    expect(importsOf(source)).toEqual(["@colyseus/core", "../src/*", "../x/*"]);
  });

  it("returns nothing for a file without imports", () => {
    expect(importsOf("export const x = 1;")).toEqual([]);
  });
});

describe("checkBoundaries", () => {
  it("accepts the clean baseline", () => {
    expect(checkBoundaries(base())).toEqual([]);
  });

  describe("manifest", () => {
    it("rejects a runtime dependency outside the layer", () => {
      const violations = checkBoundaries(
        withChange("shared", { dependencies: ["@openparty/server"] }),
      );
      expect(violations).toEqual([
        {
          path: "packages/shared/package.json",
          rule: "manifest",
          detail: "@openparty/server is not allowed in dependencies",
        },
      ]);
    });

    it("allows core and server as dev dependencies of game-client but not as runtime ones", () => {
      expect(
        rules(
          withChange("game-client", {
            devDependencies: ["@openparty/core", "@openparty/server", "@openparty/config"],
          }),
        ),
      ).toEqual([]);
      expect(rules(withChange("game-client", { dependencies: ["@openparty/core"] }))).toEqual([
        "manifest",
      ]);
    });

    it("rejects a dev dependency outside runtime plus dev-only", () => {
      expect(rules(withChange("game-ui", { devDependencies: ["@openparty/core"] }))).toEqual([
        "manifest",
      ]);
    });

    it("ignores third-party dependencies", () => {
      expect(rules(withChange("shared", { dependencies: ["zod"] }))).toEqual([]);
    });

    it("lets a game depend on any package except cli", () => {
      expect(
        rules([
          ...base(),
          game({ dependencies: ["@openparty/server", "@openparty/core", "@openparty/launcher"] }),
        ]),
      ).toEqual([]);
      expect(rules([...base(), game({ devDependencies: ["@openparty/cli"] })])).toEqual([
        "manifest",
      ]);
    });

    it("reports a package that has no layer", () => {
      expect(checkBoundaries([...base(), workspace("mystery")])).toEqual([
        {
          path: "packages/mystery/package.json",
          rule: "manifest",
          detail: "@openparty/mystery has no entry in LAYERS",
        },
      ]);
    });
  });

  describe("declared", () => {
    it("rejects an undeclared import in src", () => {
      const violations = checkBoundaries(
        withChange("game-ui", {
          files: [file("packages/game-ui/src/a.ts", "@openparty/server")],
        }),
      );
      expect(violations).toEqual([
        {
          path: "packages/game-ui/src/a.ts",
          rule: "declared",
          detail: "@openparty/server is not in dependencies",
        },
      ]);
    });

    it("accepts a declared import and a self import", () => {
      expect(
        rules(
          withChange("game-ui", {
            files: [
              file(
                "packages/game-ui/src/a.ts",
                "@openparty/shared",
                "@openparty/game-ui/components",
              ),
            ],
          }),
        ),
      ).toEqual([]);
    });

    it("rejects a dev-only import in src", () => {
      expect(
        rules(
          withChange("game-client", {
            devDependencies: ["@openparty/core"],
            files: [file("packages/game-client/src/a.ts", "@openparty/core")],
          }),
        ),
      ).toEqual(["declared"]);
    });

    it("accepts dev dependencies and config in tests", () => {
      expect(
        rules(
          withChange("game-client", {
            devDependencies: ["@openparty/core"],
            files: [
              file(
                "packages/game-client/tests/a.ts",
                "@openparty/core",
                "@openparty/config/vitest",
              ),
            ],
          }),
        ),
      ).toEqual([]);
    });

    it("rejects an undeclared import in tests", () => {
      expect(
        rules(
          withChange("core", { files: [file("packages/core/tests/a.ts", "@openparty/server")] }),
        ),
      ).toEqual(["declared"]);
    });

    it("ignores relative and third-party imports", () => {
      expect(
        rules(
          withChange("core", {
            files: [file("packages/core/src/a.ts", "./b.js", "zod")],
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("public entry", () => {
    it("accepts a subpath listed in exports", () => {
      expect(
        rules([
          ...base(),
          workspace("launcher", {
            dependencies: ["@openparty/server", "@openparty/shared", "@openparty/bots"],
            files: [file("packages/launcher/src/a.ts", "@openparty/server/node")],
          }),
        ]),
      ).toEqual([]);
    });

    it("rejects a path into src", () => {
      const violations = checkBoundaries(
        withChange("server", {
          files: [file("packages/server/src/a.ts", "@openparty/core/src/index")],
        }),
      );
      expect(violations).toEqual([
        {
          path: "packages/server/src/a.ts",
          rule: "public-entry",
          detail: "@openparty/core/src/index is not an export of @openparty/core",
        },
      ]);
    });

    it("ignores subpaths of packages outside the workspace", () => {
      expect(
        rules([
          ...base(),
          game({
            dependencies: ["@openparty/ghost"],
            files: [file("games/demo/src/a.ts", "@openparty/ghost/x")],
          }),
        ]),
      ).toEqual([]);
    });
  });

  describe("no escape", () => {
    it("rejects a relative import that leaves the package", () => {
      const violations = checkBoundaries(
        withChange("core", { files: [file("packages/core/src/a.ts", "../../server/src/x.js")] }),
      );
      expect(violations).toEqual([
        {
          path: "packages/core/src/a.ts",
          rule: "no-escape",
          detail: "../../server/src/x.js leaves packages/core",
        },
      ]);
    });

    it("accepts a relative import inside the package", () => {
      expect(
        rules(
          withChange("core", {
            files: [file("packages/core/tests/a.ts", "../src/x.js", "./y.js")],
          }),
        ),
      ).toEqual([]);
    });

    it("rejects a relative import from a package into a game", () => {
      expect(
        rules(
          withChange("core", {
            files: [file("packages/core/src/a.ts", "../../../games/demo/src/x.js")],
          }),
        ),
      ).toEqual(["no-escape", "no-escape"]);
    });

    it("rejects a games path specifier in a package", () => {
      expect(
        rules(withChange("core", { files: [file("packages/core/src/a.ts", "games/demo/src/x")] })),
      ).toEqual(["no-escape"]);
    });

    it("lets a game import relative paths inside itself", () => {
      expect(rules([...base(), game({ files: [file("games/demo/src/a.ts", "./b.js")] })])).toEqual(
        [],
      );
    });
  });

  describe("layer purity", () => {
    it.each([
      ["shared", "@colyseus/core"],
      ["shared", "svelte"],
      ["shared", "svelte/store"],
      ["shared", "node:fs"],
      ["core", "@colyseus/schema"],
      ["core", "node:path"],
      ["core", "svelte"],
      ["game-client", "@colyseus/bun-websockets"],
      ["game-client", "node:fs"],
      ["game-ui", "@colyseus/ws-transport"],
    ])("rejects %s importing %s from src", (name, specifier) => {
      expect(
        rules(withChange(name, { files: [file(`packages/${name}/src/a.ts`, specifier)] })),
      ).toEqual(["layer-purity"]);
    });

    it.each([
      ["shared", "@colyseus/schema"],
      ["game-client", "@colyseus/sdk"],
      ["game-client", "svelte"],
      ["server", "node:fs"],
      ["core", "svelte-like"],
    ])("allows %s importing %s from src", (name, specifier) => {
      expect(
        rules(withChange(name, { files: [file(`packages/${name}/src/a.ts`, specifier)] })),
      ).toEqual([]);
    });

    it("does not apply to tests", () => {
      expect(
        rules(withChange("core", { files: [file("packages/core/tests/a.ts", "node:fs")] })),
      ).toEqual([]);
    });
  });

  describe("game ui", () => {
    const ui = (...imports: string[]): Workspace[] => [
      ...base(),
      game({ files: [file("games/demo/ui/screens/a.ts", ...imports)] }),
    ];

    it("accepts the client packages, svelte and relative paths inside the game", () => {
      expect(
        rules(
          ui(
            "@openparty/game-ui",
            "@openparty/game-ui/components",
            "@openparty/game-client",
            "@openparty/shared",
            "svelte",
            "./b.svelte",
            "../../src/state.js",
            "../../src/actionNames.js",
            "../../bots/x.js",
          ),
        ),
      ).toEqual([]);
    });

    it("rejects core and server", () => {
      expect(
        rules([
          ...base(),
          game({
            dependencies: ["@openparty/core", "@openparty/server"],
            files: [file("games/demo/ui/a.ts", "@openparty/core", "@openparty/server")],
          }),
        ]),
      ).toEqual(["game-ui", "game-ui"]);
    });

    it("rejects src modules beyond the allow-list", () => {
      expect(checkBoundaries(ui("../../src/phases/Vote.js"))).toEqual([
        {
          path: "games/demo/ui/screens/a.ts",
          rule: "game-ui",
          detail: "../../src/phases/Vote.js is not an allowed src module",
        },
      ]);
    });

    it("does not apply to game src", () => {
      expect(
        rules([
          ...base(),
          game({
            dependencies: ["@openparty/core"],
            files: [file("games/demo/src/a.ts", "@openparty/core")],
          }),
        ]),
      ).toEqual([]);
    });
  });

  describe("game purity", () => {
    const files = (...list: SourceFile[]): Workspace[] => [...base(), game({ files: list })];

    it.each(["@openparty/game-ui", "@openparty/game-client", "svelte", "svelte/store"])(
      "rejects %s in game src",
      (specifier) => {
        expect(rules(files(file("games/demo/src/a.ts", specifier)))).toEqual(["layer-purity"]);
      },
    );

    it.each(["@colyseus/core", "@colyseus/bun-websockets", "@colyseus/ws-transport", "node:fs"])(
      "rejects %s in game ui",
      (specifier) => {
        expect(rules(files(file("games/demo/ui/a.ts", specifier)))).toEqual(["layer-purity"]);
      },
    );

    it("rejects the server and core packages in game ui", () => {
      const found = checkBoundaries([
        ...base(),
        game({
          dependencies: ["@openparty/server", "@openparty/core"],
          files: [file("games/demo/ui/a.ts", "@openparty/server", "@openparty/core")],
        }),
      ]);
      expect(found.map((violation) => violation.rule)).toEqual(["game-ui", "game-ui"]);
    });
  });

  describe("entry files", () => {
    const entry = (path: string, ...imports: string[]): Workspace[] => [
      ...base(),
      game({ files: [file(path, ...imports)] }),
    ];

    it.each(["server", "launch", "gamePackage"])("applies declared to games/demo/%s.ts", (name) => {
      expect(checkBoundaries(entry(`games/demo/${name}.ts`, "@openparty/core"))).toEqual([
        {
          path: `games/demo/${name}.ts`,
          rule: "declared",
          detail: "@openparty/core is not in dependencies",
        },
      ]);
    });

    it("applies public-entry to an entry file", () => {
      const found = checkBoundaries(entry("games/demo/server.ts", "@openparty/shared/src/x"));
      expect(found.map((violation) => violation.rule)).toEqual(["public-entry"]);
    });

    it("lets config and setup files use dev dependencies like tests", () => {
      const workspaces = [
        ...base(),
        game({
          devDependencies: ["@openparty/config"],
          files: [file("games/demo/vite.config.ts", "@openparty/config/vitest")],
        }),
      ];
      expect(rules(workspaces)).toEqual([]);
    });

    it("rejects an undeclared import in a config file", () => {
      const workspaces = [
        ...base(),
        game({ files: [file("games/demo/vite.config.ts", "@openparty/core")] }),
      ];
      expect(rules(workspaces)).toEqual(["declared"]);
    });

    it("scans nested package scripts as dev files", () => {
      expect(
        rules(withChange("cli", { files: [file("packages/cli/scripts/a.ts", "@openparty/core")] })),
      ).toEqual(["declared"]);
    });
  });
});
