import type { BaseGameState } from "@openparty/shared/schema";
import type { FeedbackBus } from "./FeedbackBus.js";
import type { MessageBus } from "./MessageBus.js";

interface RelayEntry {
  count: number;
  off: () => void;
}

/**
 * Relays server broadcasts for registered names to the feedback bus: one relay subscription per
 * name, wired while at least one game listener is registered for it and unwired when the last
 * leaves. Listeners survive room changes because they subscribe through the `MessageBus`.
 */
export class MessageRelay<TState extends BaseGameState = BaseGameState> {
  private readonly relays = new Map<string, RelayEntry>();

  constructor(
    private readonly bus: MessageBus<TState>,
    private readonly feedback: FeedbackBus,
  ) {}

  /** Registers `callback` for `type` with the bus and counts it for the relay; the first listener wires the relay's own bus subscription. Returns an idempotent unsubscribe that removes the count and unwires the relay when the last listener leaves. */
  listen(type: string, callback: (payload: unknown) => void): () => void {
    const offBus = this.bus.on(type, callback);
    let relay = this.relays.get(type);
    if (relay === undefined) {
      relay = {
        count: 0,
        off: this.bus.on(type, (payload) => this.feedback.emitMessage(type, payload)),
      };
      this.relays.set(type, relay);
    }
    const registered = relay;
    registered.count += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      offBus();
      registered.count -= 1;
      if (registered.count === 0) {
        registered.off();
        this.relays.delete(type);
      }
    };
  }
}
