import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ReadlinePrompter } from "../src/Prompter.js";

const setup = (terminal = false) => {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk) => {
    written += String(chunk);
  });
  const lines = createInterface({ input, output, terminal });
  const prompter = new ReadlinePrompter(lines, output, input);
  return { input, lines, prompter, written: () => written };
};

const keySetup = () => {
  const input = new PassThrough();
  const raw: boolean[] = [];
  Object.assign(input, {
    isTTY: true,
    setRawMode: (mode: boolean) => raw.push(mode),
  });
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk) => {
    written += String(chunk);
  });
  const lines = createInterface({ input, output });
  const prompter = new ReadlinePrompter(lines, output, input);
  const keys: string[] = [];
  const abort = new AbortController();
  const press = async (sequence: string): Promise<void> => {
    input.write(sequence);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { abort, input, keys, lines, press, prompter, raw, written: () => written };
};

describe("ReadlinePrompter", () => {
  it("asks a one-line question and resolves with the typed line", async () => {
    const { input, lines, prompter, written } = setup();
    const answer = prompter.ask("Name? ", new AbortController().signal);
    input.write("Ann\n");
    expect(await answer).toBe("Ann");
    expect(written()).toContain("Name? ");
    lines.close();
  });

  it("prints the head of a multi-line question and prompts with the last line", async () => {
    const { input, lines, prompter, written } = setup();
    const answer = prompter.ask("Pick one:\n1) a\n2) b\n> ", new AbortController().signal);
    input.write("2\n");
    expect(await answer).toBe("2");
    expect(written()).toContain("Pick one:\n1) a\n2) b\n");
    expect(written()).toContain("> ");
    lines.close();
  });

  it("prints the header and prompts empty when the question ends in a newline", async () => {
    const { input, lines, prompter, written } = setup();
    const answer = prompter.ask("Header\n", new AbortController().signal);
    input.write("x\n");
    expect(await answer).toBe("x");
    expect(written()).toContain("Header\n");
    lines.close();
  });

  it("redraws the pending prompt and the typed text under a printed line", async () => {
    const { input, lines, prompter, written } = setup(true);
    const answer = prompter.ask("Say: ", new AbortController().signal);
    input.write("he");
    await new Promise((resolve) => setTimeout(resolve, 10));
    prompter.print("Bob joined.");
    expect(written()).toContain("\r\x1b[KBob joined.\nSay: he");
    input.write("y\n");
    expect(await answer).toBe("hey");
    lines.close();
  });

  it("prints a bare line when nothing is pending", () => {
    const { lines, prompter, written } = setup();
    prompter.print("hello");
    expect(written()).toBe("\r\x1b[Khello\n");
    lines.close();
  });

  it("rejects when aborted and clears the pending prompt", async () => {
    const { lines, prompter, written } = setup();
    const abort = new AbortController();
    const answer = prompter.ask("Say: ", abort.signal);
    abort.abort();
    await expect(answer).rejects.toThrow();
    prompter.print("later");
    expect(written().endsWith("\r\x1b[Klater\n")).toBe(true);
    lines.close();
  });

  it("keeps a newer prompt pending when an older one settles", async () => {
    const { input, lines, prompter, written } = setup();
    const first = new AbortController();
    const older = prompter.ask("One: ", first.signal);
    first.abort();
    const newer = prompter.ask("Two: ", new AbortController().signal);
    await expect(older).rejects.toThrow();
    prompter.print("note");
    expect(written()).toContain("\r\x1b[Knote\nTwo: ");
    input.write("x\n");
    await newer;
    lines.close();
  });
});

describe("ReadlinePrompter single keys", () => {
  it("reads raw mode, decodes keys and restores the terminal when the stage ends", async () => {
    const { abort, keys, lines, press, prompter, raw } = keySetup();
    prompter.onKey((key) => keys.push(key), abort.signal);
    expect(raw).toEqual([true]);
    await press("\x1b[A");
    await press("\x1b[B");
    await press("\x1b[C");
    await press("\x1b[D");
    await press(" ");
    await press("\r");
    await press("a");
    await press("\x7f");
    expect(keys).toEqual(["up", "down", "right", "left", "space", "enter", "a", "backspace"]);
    abort.abort();
    expect(raw).toEqual([true, false]);
    await press("b");
    expect(keys).toHaveLength(8);
    lines.close();
  });

  it("decodes tab and escape", async () => {
    const { abort, input, keys, lines, press, prompter } = keySetup();
    prompter.onKey((key) => keys.push(key), abort.signal);
    await press("\t");
    // The terminal emits a bare Escape late (readline waits for more bytes), so give it time.
    input.write("\x1b");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(keys).toEqual(["tab", "escape"]);
    abort.abort();
    lines.close();
  });

  it("stops reading and restores the terminal when the handler throws", async () => {
    const { abort, keys, lines, press, prompter, raw, written } = keySetup();
    prompter.onKey(() => {
      throw new Error("boom");
    }, abort.signal);
    await press("a");
    expect(written()).toContain("Something went wrong: Error: boom");
    expect(raw).toEqual([true, false]);
    prompter.onKey((key) => keys.push(key), new AbortController().signal);
    await press("b");
    expect(keys).toEqual(["b"]);
    lines.close();
  });

  it("ignores keys it cannot name", async () => {
    const { abort, keys, lines, press, prompter } = keySetup();
    prompter.onKey((key) => keys.push(key), abort.signal);
    await press("\x1b[15~");
    expect(keys).toEqual([]);
    lines.close();
  });

  it("restores other keypress listeners when the stage ends", async () => {
    const { abort, input, keys, lines, press, prompter } = keySetup();
    const others: string[] = [];
    input.on("keypress", (_text, key) => others.push(key.name));
    prompter.onKey((key) => keys.push(key), abort.signal);
    await press("a");
    abort.abort();
    await press("b");
    expect(keys).toEqual(["a"]);
    expect(others).toEqual(["b"]);
    lines.close();
  });

  it("keeps raw mode until the last listener of a stage ends", async () => {
    const { lines, press, prompter, raw } = keySetup();
    const first = new AbortController();
    const second = new AbortController();
    const one: string[] = [];
    const two: string[] = [];
    prompter.onKey((key) => one.push(key), first.signal);
    prompter.onKey((key) => two.push(key), second.signal);
    await press("a");
    expect(one).toEqual(["a"]);
    expect(two).toEqual(["a"]);
    first.abort();
    expect(raw).toEqual([true]);
    await press("b");
    expect(one).toEqual(["a"]);
    expect(two).toEqual(["a", "b"]);
    second.abort();
    expect(raw).toEqual([true, false]);
    lines.close();
  });

  it("does nothing and says so without a terminal", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk) => {
      written += String(chunk);
    });
    const lines = createInterface({ input, output });
    const prompter = new ReadlinePrompter(lines, output, input);
    const keys: string[] = [];
    prompter.onKey((key) => keys.push(key), new AbortController().signal);
    input.write("a");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(keys).toEqual([]);
    expect(written).toContain("Single-key input needs an interactive terminal.");
    lines.close();
  });

  it("does nothing when a terminal cannot switch to raw mode", () => {
    const input = new PassThrough();
    Object.assign(input, { isTTY: true });
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk) => {
      written += String(chunk);
    });
    const lines = createInterface({ input, output });
    const prompter = new ReadlinePrompter(lines, output, input);
    prompter.onKey(() => undefined, new AbortController().signal);
    expect(written).toContain("Single-key input needs an interactive terminal.");
    lines.close();
  });

  it("does nothing when the stage has already ended", () => {
    const { abort, lines, prompter, raw } = keySetup();
    abort.abort();
    prompter.onKey(() => undefined, abort.signal);
    expect(raw).toEqual([]);
    lines.close();
  });
});

describe("ReadlinePrompter frames", () => {
  const frameSetup = (tty: boolean) => {
    const input = new PassThrough();
    const output = new PassThrough();
    if (tty) Object.assign(output, { isTTY: true });
    let written = "";
    output.on("data", (chunk) => {
      written += String(chunk);
    });
    const lines = createInterface({ input, output });
    const prompter = new ReadlinePrompter(lines, output, input);
    return { lines, prompter, written: () => written };
  };

  it("draws a frame and replaces it in place, keeping its height", () => {
    const { lines, prompter, written } = frameSetup(true);
    prompter.frame(["a", "b"]);
    expect(written()).toBe("\r\x1b[Ka\n\r\x1b[Kb\n");
    prompter.frame(["c"]);
    expect(written()).toBe("\r\x1b[Ka\n\r\x1b[Kb\n\x1b[2A\r\x1b[Kc\n\r\x1b[K\n");
    prompter.frame(["d", "e", "f"]);
    expect(written().endsWith("\x1b[2A\r\x1b[Kd\n\r\x1b[Ke\n\r\x1b[Kf\n")).toBe(true);
    lines.close();
  });

  it("resets the frame height when the last listener of a stage ends", () => {
    const { abort, lines, prompter, written } = keySetup();
    prompter.onKey(() => undefined, abort.signal);
    prompter.frame(["a", "b"]);
    abort.abort();
    const second = new AbortController();
    prompter.onKey(() => undefined, second.signal);
    prompter.frame(["x"]);
    expect(written()).toBe("\r\x1b[Ka\n\r\x1b[Kb\n\r\x1b[Kx\n");
    second.abort();
    lines.close();
  });

  it("prints plain lines when the output is not a terminal", () => {
    const { lines, prompter, written } = frameSetup(false);
    prompter.frame(["a", "b"]);
    expect(written()).toBe("\r\x1b[Ka\n\r\x1b[Kb\n");
    prompter.frame(["c"]);
    expect(written()).toBe("\r\x1b[Ka\n\r\x1b[Kb\n\r\x1b[Kc\n");
    lines.close();
  });
});
