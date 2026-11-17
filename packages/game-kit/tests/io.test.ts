import { describe, expect, it } from "vitest";
import {
  processIo,
  unavailablePrompter,
  unavailableRunLauncher,
  unavailableStartServer,
} from "../src/io.js";

describe("processIo", () => {
  it("binds the real process", () => {
    const io = processIo();
    expect(io.env).toBe(process.env);
    expect(io.argv).toEqual(process.argv.slice(2));
    expect(io.exit).toBe(process.exit);
    expect(io.log).toBe(console.log);
    expect(io.error).toBe(console.error);
  });

  it("registers signal handlers on the process", () => {
    const io = processIo();
    const handler = () => {};
    const before = process.listenerCount("SIGINT");
    io.onSignal("SIGINT", handler);
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    process.removeListener("SIGINT", handler);
  });
});

describe("unavailable capability stubs", () => {
  it("throw when called, naming the entry and the missing capability", () => {
    expect(() => unavailablePrompter("serve")(() => {})).toThrow("serve does not provide prompter");
    expect(() => unavailableStartServer("launch")({ games: [] })).toThrow(
      "launch does not provide startServer",
    );
    expect(() => unavailableRunLauncher("demo")({ gameDir: "x", name: "y" }, [])).toThrow(
      "demo does not provide runLauncher",
    );
  });
});
