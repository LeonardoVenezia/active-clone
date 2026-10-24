// Data a Manual trigger asks for when the user runs the flow. Pure (no server-only), shared by the UI, the execute route, the build validator and the prompt.
// Contract (the only shape the app supports): Manual trigger config { inputFields: [{ key, label, required? }] }.
// The run dialog collects the values; POST /api/workflow/:id/execute sends them as `input`; the engine merges `input` into the trigger output,
// so later steps read them as {{@<trigger-id>:<Trigger label>.<key>}}.
export type ManualInputField = { key: string; label: string; required: boolean };
export const MANUAL_INPUT_MAX_FIELDS = 8;
export const MANUAL_INPUT_MAX_VALUE = 500;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
// Reserved by the trigger output, plus names that exist on every JS object (never usable as data keys).
const RESERVED = new Set(["triggered", "timestamp", "constructor", "prototype", "proto", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"]);

type NodeLike = { id?: string; data?: { type?: string; label?: string; config?: Record<string, unknown> } };

/** Valid fields of one Manual trigger config; invalid entries are dropped (use manualInputProblems to report them). */
export function parseInputFields(config: Record<string, unknown> | undefined): ManualInputField[] {
  const raw = config?.inputFields;
  if (!Array.isArray(raw)) return [];
  const out: ManualInputField[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const { key, label, required } = f as { key?: unknown; label?: unknown; required?: unknown };
    if (typeof key !== "string" || !KEY_RE.test(key) || RESERVED.has(key) || out.some((x) => x.key === key)) continue;
    out.push({ key, label: typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : key, required: required !== false });
    if (out.length >= MANUAL_INPUT_MAX_FIELDS) break;
  }
  return out;
}

/** Human-readable problems with a Manual trigger's inputFields (empty when fine or absent). */
export function manualInputProblems(config: Record<string, unknown> | undefined): string[] {
  const raw = config?.inputFields;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return ["inputFields must be a list of {key, label}"];
  const problems: string[] = [];
  const seen = new Set<string>();
  raw.forEach((f, i) => {
    const key = (f as { key?: unknown } | null)?.key;
    if (typeof key !== "string" || !KEY_RE.test(key)) problems.push(`inputFields[${i}].key must be a short identifier (letters, digits, underscore; starts with a letter)`);
    else if (RESERVED.has(key)) problems.push(`inputFields[${i}].key "${key}" is reserved`);
    else if (seen.has(key)) problems.push(`inputFields has the key "${key}" twice`);
    else seen.add(key);
  });
  if (raw.length > MANUAL_INPUT_MAX_FIELDS) problems.push(`inputFields allows at most ${MANUAL_INPUT_MAX_FIELDS} fields`);
  return problems;
}

/** Fields asked by the workflow's Manual trigger (none for other trigger types). */
export function manualInputFields(nodes: NodeLike[] | undefined): ManualInputField[] {
  const trig = (nodes ?? []).find((n) => n?.data?.type === "trigger");
  const cfg = trig?.data?.config;
  const type = cfg?.triggerType;
  if (!trig || !(type === undefined || type === "" || type === "Manual")) return [];
  return parseInputFields(cfg);
}

/** Keeps only declared keys, as trimmed strings. Returns the cleaned input, the labels of required fields still empty, and the labels of values over the length limit (never truncated: the caller must reject). */
export function prepareInput(fields: ManualInputField[], raw: unknown): { input: Record<string, string>; missing: string[]; tooLong: string[] } {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const input: Record<string, string> = {};
  const missing: string[] = [];
  const tooLong: string[] = [];
  for (const f of fields) {
    const v = Object.prototype.hasOwnProperty.call(src, f.key) ? src[f.key] : undefined;
    const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    if (s.length > MANUAL_INPUT_MAX_VALUE) tooLong.push(f.label);
    else if (s) input[f.key] = s;
    else if (f.required) missing.push(f.label);
  }
  return { input, missing, tooLong };
}

type FlowLike = { id: string; data?: { type?: string; config?: Record<string, unknown> } };
const REF_RE = /\{\{@([^:}]+):([^}]+)\}\}/g;
const refsOf = (v: unknown, out: { id: string; field: string }[]): void => {
  if (typeof v === "string") { for (const m of v.matchAll(REF_RE)) out.push({ id: m[1], field: (m[2].split(".")[1] ?? "").replace(/\[\d+\]$/, "") }); }
  else if (Array.isArray(v)) v.forEach((x) => refsOf(x, out));
  else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => refsOf(x, out));
};

/** Build-time check: a Manual trigger's inputFields must be well formed, and steps may only read fields the run dialog really asks for (or triggered/timestamp). */
export function manualInputError(nodes: FlowLike[]): string | null {
  const manual = nodes.filter((n) => n.data?.type === "trigger" && n.data.config?.triggerType === "Manual");
  const errs: string[] = [];
  for (const m of manual) {
    const problems = manualInputProblems(m.data?.config);
    if (problems.length) errs.push(`Manual trigger "${m.id}": ${problems.join("; ")}`);
  }
  for (const m of manual) {
    const declared = new Set(["triggered", "timestamp", ...parseInputFields(m.data?.config).map((f) => f.key)]);
    const bad = new Set<string>();
    for (const n of nodes) {
      if (n.id === m.id) continue;
      const refs: { id: string; field: string }[] = [];
      refsOf(n.data?.config, refs);
      for (const r of refs) if (r.id.replace(/[^a-zA-Z0-9]/g, "_") === m.id.replace(/[^a-zA-Z0-9]/g, "_") && r.field && !declared.has(r.field)) bad.add(r.field);
    }
    if (bad.size) errs.push(`Steps read ${[...bad].map((b) => `"${b}"`).join(", ")} from the Manual trigger "${m.id}", but the trigger does not ask for it. The app only asks for the keys listed in the trigger's inputFields ([{"key","label"}]); add the key there if the user must choose it at run time, or put the value in the step.`);
  }
  return errs.length ? errs.join(" | ") : null;
}

const KNOWN_STRUCT_KEYS = new Set(["item", "items", "fields", "key", "label", "required"]);
export type ToolRejectMeta = { tool: string; field: "inputFields"; received: "array" | "object" | "string" | "number" | "boolean" | "null" | "other"; structuralKeys: string[]; result: "rejected" };

/** Edge validation of a tool's config patch against the CANDIDATE state (existing config + patch).
 *  Only judges inputFields, and only when the patch itself sets it, so drafts are never blocked for fields the patch does not touch.
 *  Pure: never rewrites the value. Metadata is an allowlist (no values, labels, ids or prompts). */
export function candidateConfigProblem(tool: string, existing: Record<string, unknown> | undefined, patch: Record<string, unknown> | undefined): { problems: string[]; meta: ToolRejectMeta } | null {
  if (!patch || !Object.prototype.hasOwnProperty.call(patch, "inputFields")) return null;
  const candidate = { ...(existing ?? {}), ...patch };
  const problems = manualInputProblems(candidate);
  if (!problems.length) return null;
  const v = (patch as Record<string, unknown>).inputFields;
  const received: ToolRejectMeta["received"] = Array.isArray(v) ? "array" : v === null ? "null" : typeof v === "object" ? "object" : typeof v === "string" ? "string" : typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "other";
  const structuralKeys = v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).filter(k => KNOWN_STRUCT_KEYS.has(k)) : [];
  return { problems, meta: { tool, field: "inputFields", received, structuralKeys, result: "rejected" } };
}
