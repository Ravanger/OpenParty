import {
  InvalidPrivateStateError,
  type MiddlewareContext,
  type PhaseState,
} from "./runtime/index.js";

/** A per-`ctx.priv` store: one value per private-state object, kept outside `priv` itself. */
export interface PrivStore<T> {
  /** The stored value for `priv`, or `undefined` when nothing was recorded yet (or `priv` is not an object). */
  get(priv: unknown): T | undefined;
  /**
   * The stored value for `ctx.priv`, created by `create` on first access. Throws
   * {@link InvalidPrivateStateError} when `ctx.priv` is not an object.
   */
  of(ctx: MiddlewareContext<PhaseState, unknown, unknown>): T;
}

/**
 * A module-level store keyed by the runtime's private-state object: owns the `WeakMap` and the
 * non-object guard (throwing {@link InvalidPrivateStateError} on first write, returning
 * `undefined` on a plain read), so `priv` never gains a framework key. `create` runs once per
 * priv, with the first context seen for it.
 */
export function privStore<T>(
  create: (ctx: MiddlewareContext<PhaseState, unknown, unknown>) => T,
): PrivStore<T> {
  const values = new WeakMap<object, T>();
  return {
    get(priv) {
      if (typeof priv !== "object" || priv === null) return undefined;
      return values.get(priv);
    },
    of(ctx) {
      const priv = ctx.priv;
      if (typeof priv !== "object" || priv === null) throw new InvalidPrivateStateError();
      let value = values.get(priv);
      if (value === undefined) {
        value = create(ctx);
        values.set(priv, value);
      }
      return value;
    },
  };
}
