/**
 * Re-keys a round module's screen table by its mount prefix: a local phase `X` becomes `<prefix>_X`,
 * the name the host sees once the module is mounted. Spread the result into the game's screen table.
 * The result carries exactly the prefixed literal keys (no string index signature), so a table that
 * is missing one of the module's phases still fails a compile-time exhaustiveness check.
 *
 * @experimental Round module API; may change before 1.0.
 */
export function prefixedScreens<T extends Record<string, unknown>, const P extends string>(
  screens: T,
  prefix: P,
): { [K in keyof T & string as `${P}_${K}`]: T[K] } {
  const out: Record<string, T[keyof T]> = {};
  for (const [local, screen] of Object.entries(screens) as Array<[string, T[keyof T]]>) {
    out[`${prefix}_${local}`] = screen;
  }
  return out as { [K in keyof T & string as `${P}_${K}`]: T[K] };
}
