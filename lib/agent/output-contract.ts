// Output contracts that the generic outputFields list cannot express. Pure (no server-only imports).
// 1) ai-gateway/generate-text: `text` is returned for aiFormat "text"/unset, `object` ONLY for aiFormat "object" with a valid aiSchema.
//    aiSchema is a JSON ARRAY of {name,type} (plugins/ai-gateway/steps/generate-text.ts buildZodSchema); types other than
//    string|number|boolean are silently dropped by the plugin. A JSON-Schema object is not iterable and the step fails.
// 2) A Fórmula whose input has no templates and whose expression is a plain path or a JSON literal has a statically known result.
// Anything not covered here stays "unknown": outputFields are NOT assumed exhaustive.

import { resolveFieldValue } from "@/lib/field-path";

export const AI_TEXT_ACTION = "ai-gateway/generate-text";
const SCHEMA_TYPES = ["string", "number", "boolean"];
export const ENVELOPE_FIELDS = ["success", "data", "error"];

export type AiSchemaCheck = { ok: true; names: string[] } | { ok: false; problem: string };

export function checkAiSchema(raw: unknown): AiSchemaCheck {
  const example = '[{"name":"titulo","type":"string"},{"name":"precio","type":"number"}]';
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return { ok: false, problem: `aiSchema is not valid JSON; it must be a JSON array of fields like ${example}` }; }
  }
  if (!Array.isArray(v)) return { ok: false, problem: `aiSchema must be a JSON ARRAY of {"name","type"} fields like ${example}; a JSON Schema object ({"type":"object","properties":...}) is not supported and makes the step fail` };
  if (v.length === 0) return { ok: false, problem: `aiSchema is an empty array; list at least one field like ${example}` };
  const names: string[] = [];
  for (const [i, f] of v.entries()) {
    const o = f as { name?: unknown; type?: unknown } | null;
    if (!o || typeof o !== "object" || typeof o.name !== "string" || !o.name.trim()) return { ok: false, problem: `aiSchema field ${i + 1} needs a non-empty "name"` };
    if (typeof o.type !== "string" || !SCHEMA_TYPES.includes(o.type)) return { ok: false, problem: `aiSchema field "${o.name}" has type ${JSON.stringify(o.type)}; the supported types are string, number and boolean (any other type is dropped and the field never comes back)` };
    names.push(o.name);
  }
  return { ok: true, names };
}

export type AiOutput = { kind: "text" } | { kind: "object"; names: string[] };
/** What a generate-text step really returns for this config. Matches the plugin: object only when format is "object" AND aiSchema is truthy and valid. */
export function aiOutputOf(cfg: Record<string, unknown> | undefined): AiOutput {
  const c = cfg ?? {};
  if (c.aiFormat === "object" && c.aiSchema) { const s = checkAiSchema(c.aiSchema); if (s.ok) return { kind: "object", names: s.names }; }
  return { kind: "text" };
}

/** Problem with reading `fieldPath` (the part after the label, e.g. "object.titulo") from a generate-text step with this config, or null. */
export function aiFieldPathProblem(cfg: Record<string, unknown> | undefined, fieldPath: string, how: string): string | null {
  const segs = fieldPath.split(".");
  const first = (segs[0] ?? "").replace(/\[\d+\]$/, "");
  // The AI step returns exactly {success,text|object} or {success:false,error}: .data does NOT exist on it, nor does an invented .object.
  if (first === "success" || first === "error") return null;
  const out = aiOutputOf(cfg);
  if (out.kind === "text") {
    if (first === "text") return null;
    if (first && first !== "object") return `${how} -> field ".${first}" does not exist: an AI text step returns only ".text" (plus success/error); to get named fields set aiFormat "object" with an aiSchema array and read ".object.<name>"`;
    if (first === "object") return `${how} reads ".object", but this AI step returns only ".text" (aiFormat ${cfg?.aiFormat === "object" ? '"object" without a valid aiSchema' : 'is not "object"'}); either set aiFormat "object" with an aiSchema array, or read ".text"`;
    return null;
  }
  if (first === "text") return `${how} reads ".text", but this AI step has aiFormat "object" with an aiSchema, so it returns ".object.<field>" (fields: ${out.names.join(", ")}) and no ".text"`;
  if (first === "object") {
    const f = (segs[1] ?? "").replace(/\[\d+\]$/, "");
    if (!f) return null;
    if (!out.names.includes(f)) return `${how} reads ".object.${f}", but the aiSchema of this AI step only defines: ${out.names.join(", ")}`;
    return null;
  }
  if (out.names.includes(first)) return `${how} reads ".${first}" directly; an AI object result is read as ".object.${first}"`;
  return `${how} -> field ".${first}" does not exist: this AI step returns only ".object.<${out.names.join("|")}>" (plus success/error)`;
}

// ---- constant Fórmula ----
export type ConstFormula = { known: true; value: unknown } | { known: false };
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const JSONATA_WORDS = new Set(["true", "false", "null", "and", "or", "in", "function", "$"]); // parsed as literals/operators, not field names
const MAX_CONST_BYTES = 65536;
/** Statically known `result` of a Fórmula, only when no code has to run: input without {{templates}} (JSON), expression a plain dotted path
 *  over that input (no array traversal) or a JSON literal. Everything else (any JSONata operator/function) is unknown. */
export function constantFormulaResult(cfg: Record<string, unknown> | undefined): ConstFormula {
  const input = cfg?.input; const expr = cfg?.expression;
  if (typeof expr !== "string" || !expr.trim() || expr.length > 2000) return { known: false };
  let data: unknown;
  if (typeof input === "string") {
    if (input.length > MAX_CONST_BYTES || input.includes("{{")) return { known: false };
    if (!input.trim()) return { known: false };
    try { data = JSON.parse(input); } catch { return { known: false }; }
  } else if (input === undefined || input === null) data = {};
  else if (typeof input === "object") { try { if (JSON.stringify(input).includes("{{")) return { known: false }; } catch { return { known: false }; } data = input; }
  else return { known: false };
  const e = expr.trim();
  if (PATH_RE.test(e) && !e.split(".").some((w) => JSONATA_WORDS.has(w))) {
    let cur: unknown = data;
    for (const p of e.split(".")) {
      if (Array.isArray(cur) || !cur || typeof cur !== "object") return { known: false }; // JSONata maps over arrays; not modelled
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur === undefined ? { known: false } : { known: true, value: cur };
  }
  // JSON-literal subset: only an object or array literal with no nested-array flattening differences (JSONata array constructors keep nesting; checked in the differential test).
  if (e.startsWith("{") || e.startsWith("[")) { try { return { known: true, value: JSON.parse(e) }; } catch { return { known: false }; } }
  return { known: false };
}

const kindOf = (v: unknown) => (Array.isArray(v) ? "an array" : v === null ? "null" : typeof v === "object" ? `an object with the keys ${Object.keys(v as object).slice(0, 8).join(", ") || "(none)"}` : `a ${typeof v}`);
/** `restPath` is what follows "<Label>." in the Loop source ref (e.g. "result" or "result.angulos"). Resolved with the ENGINE's own resolver on the
 *  statically known result. Null when the source is a list or the result is not statically known. */
export function loopSourceFormulaProblem(formulaCfg: Record<string, unknown> | undefined, restPath: string): string | null {
  const c = constantFormulaResult(formulaCfg);
  if (!c.known) return null;
  if (restPath.split(".")[0] !== "result") return null;
  const cur = resolveFieldValue({ success: true, result: c.value }, restPath);
  if (Array.isArray(cur)) return null;
  if (cur === undefined) return `its Fórmula returns ${kindOf(c.value)}; "${restPath}" does not exist in it (the Loop would fail with "source is not a list"). Point the source at "result" when the expression returns the list itself`;
  return `"${restPath}" of its Fórmula is ${kindOf(cur)}, not a list`;
}
