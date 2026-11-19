import type { Interface } from "node:readline/promises";
import { ReadlinePrompter } from "@openparty/terminal";
import { describe, expect, it } from "vitest";
import { botsIo } from "../src/botsCli.js";
import { demoIo } from "../src/demoCli.js";
import { launchIo } from "../src/launch.js";
import { playIo, readlinePrompter } from "../src/play.js";
import { serveIo } from "../src/serve.js";

describe("per-entry default ios", () => {
  it("bind the real process for every entry", () => {
    for (const io of [serveIo, launchIo, playIo, botsIo, demoIo]) {
      expect(io.env).toBe(process.env);
      expect(io.argv).toEqual(process.argv.slice(2));
      expect(io.exit).toBe(process.exit);
      expect(io.log).toBe(console.log);
      expect(io.error).toBe(console.error);
    }
  });

  it("serve refuses the prompter and launcher capabilities", () => {
    expect(() => serveIo.prompter(() => {})).toThrow("serve does not provide prompter");
    expect(() => serveIo.runLauncher({ gameDir: "x", name: "y" }, [])).toThrow(
      "serve does not provide runLauncher",
    );
  });

  it("launch refuses the prompter and server starter", () => {
    expect(() => launchIo.prompter(() => {})).toThrow("launch does not provide prompter");
    expect(() => launchIo.startServer({ games: [] })).toThrow(
      "launch does not provide startServer",
    );
  });

  it("play refuses the server starter and launcher", () => {
    expect(() => playIo.startServer({ games: [] })).toThrow("play does not provide startServer");
    expect(() => playIo.runLauncher({ gameDir: "x", name: "y" }, [])).toThrow(
      "play does not provide runLauncher",
    );
  });

  it("bots and demo refuse every capability", () => {
    for (const [entry, io] of [
      ["bots", botsIo],
      ["demo", demoIo],
    ] as const) {
      expect(() => io.prompter(() => {})).toThrow(`${entry} does not provide prompter`);
      expect(() => io.startServer({ games: [] })).toThrow(`${entry} does not provide startServer`);
      expect(() => io.runLauncher({ gameDir: "x", name: "y" }, [])).toThrow(
        `${entry} does not provide runLauncher`,
      );
    }
  });

  it("play's default prompter wraps the process stdin", () => {
    const prompter = readlinePrompter(() => {});
    expect(prompter).toBeInstanceOf(ReadlinePrompter);
    (Reflect.get(prompter, "lines") as Interface).close();
  });
});
