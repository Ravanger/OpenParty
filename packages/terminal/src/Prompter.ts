import { emitKeypressEvents, type Key } from "node:readline";
import type { Interface } from "node:readline/promises";

/**
 * A decoded key press: an arrow (`"up"`, `"down"`, `"left"`, `"right"`), `"enter"`, `"space"`,
 * `"escape"`, `"backspace"`, `"tab"`, or the typed character itself (`"a"`, `"7"`).
 * @experimental Real-time terminal input for stages that cannot wait for a whole line.
 */
export type KeyName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "space"
  | "escape"
  | "backspace"
  | "tab"
  | (string & {});

/** The player's screen and keyboard. `ask` rejects when `signal` aborts. */
export interface Prompter {
  ask(question: string, signal: AbortSignal): Promise<string>;
  print(line: string): void;
  /**
   * Calls `handler` for each single key press until `signal` aborts, then restores the terminal
   * mode; the last listener of a stage puts it back. A handler that throws stops that listener
   * and is reported.
   * @experimental Real-time terminal input.
   */
  onKey(handler: (key: KeyName) => void, signal: AbortSignal): void;
  /**
   * Replaces the block of lines the previous call drew, in place and without scrolling; prints
   * them as plain lines when the output is not a terminal.
   * @experimental Real-time terminal input.
   */
  frame(lines: readonly string[]): void;
}

/** How a key handler that throws is reported; that listener stops. @experimental Real-time terminal input. */
export const KEY_FAILURE = "Something went wrong";

/** Said instead of reading keys when there is no interactive terminal. */
const NO_TERMINAL = "Single-key input needs an interactive terminal.";

const NAMED_KEYS: ReadonlyMap<string | undefined, KeyName> = new Map<string | undefined, KeyName>([
  ["up", "up"],
  ["down", "down"],
  ["left", "left"],
  ["right", "right"],
  ["return", "enter"],
  ["space", "space"],
  ["escape", "escape"],
  ["backspace", "backspace"],
  ["tab", "tab"],
]);

/** The decoded name of one keypress, or `undefined` for keys a stage cannot use. */
const decodeKey = (text: string | undefined, key: Key): KeyName | undefined => {
  const named = NAMED_KEYS.get(key.name);
  if (named !== undefined) return named;
  return text === undefined || text === "" ? undefined : text;
};

/** A stdin that can switch to raw mode: a terminal, or a test double that says it is one. */
interface KeyStream extends NodeJS.ReadableStream {
  readonly isRaw?: boolean;
  setRawMode(mode: boolean): void;
}

/** `stream` as a key source, or `undefined` when it cannot read single keys. */
const keyStream = (stream: NodeJS.ReadableStream): KeyStream | undefined => {
  const candidate = stream as Partial<KeyStream> & { readonly isTTY?: boolean };
  if (candidate.isTTY !== true || candidate.setRawMode === undefined) return undefined;
  return candidate as KeyStream;
};

/** Whether `stream` is a terminal (a plain stream has no `isTTY`). */
const isTerminal = (stream: NodeJS.WritableStream): boolean =>
  (stream as { readonly isTTY?: boolean }).isTTY === true;

/** A {@link Prompter} on a readline interface; `print` redraws the pending question and the text typed so far. */
export class ReadlinePrompter implements Prompter {
  private pending = "";
  private height = 0;
  private sessions = 0;
  private echo: unknown[] = [];
  private raw = false;

  constructor(
    private readonly lines: Interface,
    private readonly out: NodeJS.WritableStream = process.stdout,
    private readonly input: NodeJS.ReadableStream = process.stdin,
  ) {}

  /** Shows `question` and resolves with the typed line; rejects when `signal` aborts. */
  async ask(question: string, signal: AbortSignal): Promise<string> {
    const prompt = question.slice(question.lastIndexOf("\n") + 1);
    // `slice(0, -prompt.length)` would be `slice(0, 0)` when the prompt is empty (a question
    // ending in "\n"), swallowing the header; count from the length instead.
    if (question.includes("\n")) this.out.write(question.slice(0, question.length - prompt.length));
    this.pending = prompt;
    try {
      return await this.lines.question(prompt, { signal });
    } finally {
      if (this.pending === prompt) this.pending = "";
    }
  }

  /** Writes `line` above the pending question without losing what the player has typed. */
  print(line: string): void {
    this.out.write(`\r\x1b[K${line}\n${this.pending}${this.pending ? this.lines.line : ""}`);
  }

  /** Reads single keys in raw mode until `signal` aborts; says so and does nothing without a terminal. @experimental Real-time terminal input. */
  onKey(handler: (key: KeyName) => void, signal: AbortSignal): void {
    const keys = keyStream(this.input);
    if (keys === undefined) {
      this.print(NO_TERMINAL);
      return;
    }
    if (signal.aborted) return;
    if (this.sessions === 0) this.startKeys(keys);
    ++this.sessions;
    const stop = (): void => {
      signal.removeEventListener("abort", stop);
      this.input.removeListener("keypress", pressed);
      --this.sessions;
      if (this.sessions === 0) {
        // The stage is over: the next stage's first frame draws from the current cursor,
        // not from wherever the last stage finished.
        this.height = 0;
        this.stopKeys(keys);
      }
    };
    const pressed = (text: string | undefined, key: Key): void => {
      const name = decodeKey(text, key);
      if (name === undefined) return;
      try {
        handler(name);
      } catch (error) {
        stop();
        this.print(`${KEY_FAILURE}: ${String(error)}`);
      }
    };
    this.input.on("keypress", pressed);
    signal.addEventListener("abort", stop, { once: true });
  }

  private startKeys(keys: KeyStream): void {
    emitKeypressEvents(this.input);
    this.raw = keys.isRaw === true;
    // A readline line edit echoes every key; that would write over the frame a stage draws.
    this.echo = this.input.listeners("keypress");
    this.input.removeAllListeners("keypress");
    keys.setRawMode(true);
  }

  private stopKeys(keys: KeyStream): void {
    for (const listener of this.echo) {
      this.input.on("keypress", listener as (...args: unknown[]) => void);
    }
    this.echo = [];
    keys.setRawMode(this.raw);
  }

  /** Replaces the block the previous `frame` drew, from its first line, clearing what it left. @experimental Real-time terminal input. */
  frame(lines: readonly string[]): void {
    if (!isTerminal(this.out)) {
      for (const line of lines) this.print(line);
      return;
    }
    const height = Math.max(this.height, lines.length);
    const rows: string[] = [];
    for (let i = 0; i < height; ++i) rows.push(`\r\x1b[K${lines[i] ?? ""}`);
    const up = this.height === 0 ? "" : `\x1b[${this.height}A`;
    this.height = height;
    this.out.write(`${up}${rows.join("\n")}\n`);
  }
}
