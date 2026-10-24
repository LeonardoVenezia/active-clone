// What a Loop exposes per inner step in items[].steps.<id>.
// Plugins return either a flat result ({success, text}) or a wrapped one ({success, data:{...}}). The template resolver only unwraps
// `data` at the ROOT of a referenced output, and Formula (JSONata) never unwraps, so a path through steps.<id> used to depend on the
// plugin's shape. Additive fix: for a wrapped result, the data fields are ALSO exposed flat next to `success`/`data`.
// `data` itself is kept untouched, so every existing `.data.<field>` path keeps working.
export function exposeStepOutput(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  if (typeof r.success !== "boolean" || !("data" in r)) return result;
  const d = r.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return result;
  return { ...(d as Record<string, unknown>), ...r };
}
