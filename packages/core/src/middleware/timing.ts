import { privStore } from "../privStore.js";
import type { PhaseMiddleware, PhaseState } from "../runtime/index.js";

/** One phase's timing record, stored by {@link timingMiddleware} outside `priv`. */
export interface PhaseTimingRecord {
  /** Epoch ms when the phase was most recently entered. */
  enteredAt: number;
  /** Completed durations in ms, oldest first. The currently open entry is not included. */
  durationsMs: number[];
}

/** One timing store per `ctx.priv` object; the priv itself never gains a framework key. */
const timings = privStore<Record<string, PhaseTimingRecord>>(() => ({}));

/**
 * Reads the phase-timing store recorded for a runtime's private state. Returns the stored object
 * itself — a stable reference across calls — or `undefined` when no phase has been entered yet
 * (or the priv is not an object).
 */
export function getPhaseTimings(priv: unknown): Record<string, PhaseTimingRecord> | undefined {
  return timings.get(priv);
}

/**
 * Records how long each phase stays open into a store kept outside `ctx.priv` (keyed by it; read
 * back with `getPhaseTimings`). Started on enter (before the hook runs), closed when a transition
 * out of the phase is observed. Never touches `ctx.state`; timing metadata stays server-side. The
 * currently open phase has no final duration yet.
 */
export function timingMiddleware(): PhaseMiddleware<PhaseState, unknown, unknown> {
  return (ctx, next) => {
    const event = ctx.event;
    if (event.kind === "enter") {
      const store = timings.of(ctx);
      const existing = store[ctx.phase];
      store[ctx.phase] = { enteredAt: ctx.now(), durationsMs: existing?.durationsMs ?? [] };
    } else if (event.kind === "transition") {
      const record = timings.of(ctx)[event.from];
      if (record !== undefined) {
        record.durationsMs.push(ctx.now() - record.enteredAt);
      }
    }
    next();
  };
}
