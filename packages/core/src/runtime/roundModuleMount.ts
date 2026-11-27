/**
 * What a mount reports to `defineGame`: which phases it claims and under which prefix. The mount
 * attaches it to the record it returns (and to every wrapped phase) under a unique-per-mount
 * symbol; `defineGame` reads it there and rejects a colliding game. It exists at runtime
 * (not in `kits`) so test-only readers can reuse the same shape without importing the kit.
 */
export interface RoundModuleMountInfo {
  /** The module's `id`, for problem messages. */
  readonly moduleId: string;
  /** The prefix the module was mounted with. */
  readonly prefix: string;
  /** Every phase name the mount claims to own, prefixed. */
  readonly phaseNames: readonly string[];
}

/** True when `value` is a `RoundModuleMountInfo`. */
export const isRoundModuleMountInfo = (value: unknown): value is RoundModuleMountInfo => {
  if (value === null || typeof value !== "object") return false;
  const info = value as Record<string, unknown>;
  return (
    typeof info.moduleId === "string" &&
    typeof info.prefix === "string" &&
    Array.isArray(info.phaseNames) &&
    info.phaseNames.every((name) => typeof name === "string")
  );
};

/** Every mount record found on a merged phases record, as `[symbol, info]` pairs. */
export function roundModuleMounts(
  phases: Record<string, unknown>,
): Array<[symbol, RoundModuleMountInfo]> {
  const mounts: Array<[symbol, RoundModuleMountInfo]> = [];
  for (const symbol of Object.getOwnPropertySymbols(phases)) {
    const info: unknown = Reflect.get(phases, symbol);
    if (isRoundModuleMountInfo(info)) mounts.push([symbol, info]);
  }
  return mounts;
}
