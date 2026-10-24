/** The ONE place that decides how a config patch combines with a node's existing config (shallow: a patched key replaces the old value, arrays are never merged by index). */
export function mergeConfig(existing: Record<string, unknown> | undefined, patch: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...(existing ?? {}), ...(patch ?? {}) };
}
