import { KEY_FAILURE, type KeyName, type Prompter } from "./Prompter.js";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A prompter that records what it was asked and waits for the test to answer. */
export class ScriptedIo implements Prompter {
  readonly asked: string[] = [];
  readonly printed: string[] = [];
  readonly signals: AbortSignal[] = [];
  readonly frames: string[][] = [];
  private readonly keyHandlers = new Set<(key: KeyName) => void>();
  private waiting: ((text: string) => void) | undefined;

  /** Records the question and signal, then waits for `type` to answer it. @experimental Real-time terminal input. */
  ask(question: string, signal: AbortSignal): Promise<string> {
    this.asked.push(question);
    this.signals.push(signal);
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }

  /** Records `line` in `printed`. */
  print(line: string): void {
    this.printed.push(line);
  }

  /** Listens for the stage's single keys until `signal` aborts. The real prompter checks the TTY first and then `signal.aborted`, but this fake is a terminal by definition — it has no TTY to check and so returns silently at an already-aborted stage; a handler that throws stops that listener and is reported. @experimental Real-time terminal input. */
  onKey(handler: (key: KeyName) => void, signal: AbortSignal): void {
    if (signal.aborted) return;
    const listening = (key: KeyName): void => {
      try {
        handler(key);
      } catch (error) {
        this.keyHandlers.delete(listening);
        this.print(`${KEY_FAILURE}: ${String(error)}`);
      }
    };
    this.keyHandlers.add(listening);
    signal.addEventListener("abort", () => this.keyHandlers.delete(listening), { once: true });
  }

  /** Delivers `key` to the stage's key handlers, as a terminal would. @experimental Real-time terminal input. */
  press(key: KeyName): void {
    for (const handler of [...this.keyHandlers]) handler(key);
  }

  /** Whether the current stage is listening for single keys. @experimental Real-time terminal input. */
  get listening(): boolean {
    return this.keyHandlers.size > 0;
  }

  /** Records `lines` in `frames`. @experimental Real-time terminal input. */
  frame(lines: readonly string[]): void {
    this.frames.push([...lines]);
  }

  /** Types `text` into the pending question and lets the player react. @experimental Real-time terminal input. */
  async type(text: string): Promise<void> {
    const resolve = this.waiting;
    this.waiting = undefined;
    resolve?.(text);
    await tick();
    await tick();
  }

  /** Whether a question is waiting for `type`. @experimental Real-time terminal input. */
  get isWaiting(): boolean {
    return this.waiting !== undefined;
  }

  /** The most recent question asked, or an empty string when none was. @experimental Real-time terminal input. */
  get lastQuestion(): string {
    return this.asked[this.asked.length - 1] ?? "";
  }
}
