// REPORT-ONLY reference/contract analysis. It never repairs or blocks. Pure (no server-only imports).
// Classes (strongest claim first):
//  unresolved-target : the {{@id:...}} points to a node/inner step that does not exist (the engine leaves the literal text in place).
//  unfillable        : the target is a Manual trigger and the field is not triggered/timestamp: the UI cannot supply it, so it is empty at run time.
//  shape-mismatch    : the target's output shape is known from the engine (Formula, Loop, Loop item entries) and the first path segment is not in it.
//  ambiguous         : may or may not resolve (e.g. Formula `result.result` is valid only if the formula returns an object with a "result" key).
//  undeclared        : the action declares outputFields but the field is not listed. outputFields may be incomplete, so this does NOT prove invalid.
//  unknown           : no declared contract or dynamic shape (triggers, loop items of unknown source, actions without outputFields).
//  ok                : first segment is in a declared or known shape.
export type RefFinding = { where: string; ref: string; cls: "unresolved-target" | "unfillable" | "shape-mismatch" | "ambiguous" | "undeclared" | "unknown" | "ok"; note?: string };
export type RefNode = { id: string; label?: string; actionType?: string; config?: Record<string, unknown> };
export type DeclaredFields = (actionType: string) => string[] | undefined;

const LOOP_FIELDS = ["results", "items", "failed", "filtered", "count", "completed", "failedCount", "filteredCount", "truncated"];
const LOOP_ENTRY_FIELDS = ["index", "item", "steps", "filtered"];
const FORMULA_FIELDS = ["result", "success", "error"];
const san = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "_");
const first = (path: string) => (path.split(".")[0] ?? "").replace(/\[\d+\]$/, "");

function refsIn(v: unknown, out: { ref: string; id: string; rest: string; key: string }[], key = ""): void {
  if (typeof v === "string") {
    for (const m of v.matchAll(/\{\{@([^:}]+):([^}]+)\}\}/g)) {
      const dot = m[2].indexOf(".");
      out.push({ ref: m[0], id: m[1], rest: dot === -1 ? "" : m[2].slice(dot + 1), key });
    }
  } else if (Array.isArray(v)) v.forEach((x) => refsIn(x, out, key));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) refsIn(x, out, k);
}

export function analyzeRefs(nodes: RefNode[], declared: DeclaredFields): RefFinding[] {
  const findings: RefFinding[] = [];
  const byId = new Map(nodes.map((n) => [san(n.id), n]));
  const classify = (where: string, r: { ref: string; id: string; rest: string }, target: { actionType?: string; manual?: boolean; kind: "node" | "inner" | "item" | "index" | "loop-entry" }) => {
    const f = (cls: RefFinding["cls"], note?: string) => findings.push({ where, ref: r.ref, cls, note });
    if (target.kind === "index") return f(r.rest === "number" ? "ok" : "shape-mismatch", "Index exposes only .number");
    if (target.kind === "loop-entry") return f(LOOP_ENTRY_FIELDS.includes(first(r.rest)) ? "ok" : "shape-mismatch", `Loop items entry fields: ${LOOP_ENTRY_FIELDS.join(",")}`);
    if (target.kind === "item") return f("unknown", "loop item shape depends on its source");
    const at = target.actionType ?? "";
    if (target.manual) {
      if (!r.rest) return f("ok", "whole output");
      return f(["triggered", "timestamp"].includes(first(r.rest)) ? "ok" : "unfillable", "Manual trigger output is {triggered,timestamp}; runs from the UI send an empty input, so any other field is empty at run time (the API /execute can pass one, the UI cannot)");
    }
    if (!r.rest) return f("ok", "whole output");
    const seg = first(r.rest);
    if (at === "Fórmula") {
      if (!FORMULA_FIELDS.includes(seg)) return f("shape-mismatch", "Formula output is {success,result}");
      if (r.rest.startsWith("result.result")) return f("ambiguous", "valid only if the formula returns an object with a 'result' key");
      return f("ok");
    }
    if (at === "Loop") return f(LOOP_FIELDS.includes(seg) ? "ok" : "shape-mismatch", `Loop output fields: ${LOOP_FIELDS.join(",")}`);
    if (at === "Condition" || at === "Manual" || /^[A-Z]/.test(at) && !at.includes("/")) return f("unknown", "no declared contract");
    const d = declared(at);
    if (!d) return f("unknown", "action has no outputFields");
    return f(d.includes(seg) ? "ok" : "undeclared", d.includes(seg) ? undefined : "outputFields may be incomplete; not proof of invalid");
  };
  for (const n of nodes) {
    const cfg = n.config ?? {};
    const inner = Array.isArray(cfg.steps) ? (cfg.steps as { id?: string; actionType?: string; config?: unknown }[]) : [];
    const collect = (c: unknown) => { const o: { ref: string; id: string; rest: string; key: string }[] = []; refsIn(c, o); return o; };
    const own = collect({ ...cfg, steps: undefined });
    for (const r of own) {
      const t = byId.get(san(r.id));
      if (!t) { findings.push({ where: n.id, ref: r.ref, cls: "unresolved-target" }); continue; }
      classify(n.id, r, { actionType: t.actionType, manual: t.config?.triggerType === "Manual", kind: "node" });
    }
    const innerIds = new Set<string>();
    const loopSource = typeof cfg.source === "string" ? /^\s*\{\{@([^:]+):[^.}]+\.items\}\}\s*$/.exec(cfg.source) : null;
    const sourceIsLoopItems = !!loopSource && byId.get(san(loopSource[1]))?.actionType === "Loop";
    inner.forEach((s, idx) => {
      const where = `${n.id}#${s.id ?? idx}`;
      for (const r of collect(s.config ?? s)) {
        const rid = san(r.id);
        if (rid === "item") { classify(where, r, { kind: sourceIsLoopItems ? "loop-entry" : "item" }); continue; }
        if (rid === "index") { classify(where, r, { kind: "index" }); continue; }
        if (innerIds.has(rid)) { const prev = inner.find((x) => san(x.id ?? "") === rid); classify(where, r, { actionType: prev?.actionType, kind: "inner" }); continue; }
        if (inner.some((x) => san(x.id ?? "") === rid)) { findings.push({ where, ref: r.ref, cls: "unresolved-target", note: "inner step runs later or is this step" }); continue; }
        const t = byId.get(rid);
        if (!t) { findings.push({ where, ref: r.ref, cls: "unresolved-target" }); continue; }
        classify(where, r, { actionType: t.actionType, manual: t.config?.triggerType === "Manual", kind: "node" });
      }
      innerIds.add(san(s.id ?? ""));
    });
  }
  return findings;
}

// ---- Unknown config keys (report-only) ----
// A key counts as "known" only if some code reads it (trigger keys below were derived by searching the repo) or the action declares it in configFields.
// An unknown key is NOT proof of invalid: it only says nothing in the app reads or renders it.
export type KeyFinding = { where: string; key: string; cls: "unknown-key"; note: string };
export const TRIGGER_KEYS: Record<string, string[]> = {
  Manual: [],
  Webhook: ["webhookPath", "webhookSchema", "webhookMockRequest"],
  Schedule: ["scheduleCron", "scheduleTimezone"],
};
const APP_KEYS = ["triggerType", "actionType", "integrationId", "placeholder", "fromTemplate"];
export type DeclaredKeys = (actionType: string) => string[] | undefined;

export function analyzeConfigKeys(nodes: RefNode[], declaredKeys: DeclaredKeys): KeyFinding[] {
  const out: KeyFinding[] = [];
  for (const n of nodes) {
    const cfg = n.config ?? {};
    const trig = typeof cfg.triggerType === "string" ? cfg.triggerType : undefined;
    const at = typeof cfg.actionType === "string" ? cfg.actionType : undefined;
    let known: string[] | undefined;
    if (trig && trig in TRIGGER_KEYS) known = TRIGGER_KEYS[trig];
    else if (at && at.includes("/")) known = declaredKeys(at);
    if (!known) continue;
    for (const k of Object.keys(cfg)) {
      if (APP_KEYS.includes(k) || known.includes(k)) continue;
      out.push({ where: n.id, key: k, cls: "unknown-key", note: trig ? `no code reads this key on a ${trig} trigger (the UI run sends an empty input)` : `not in ${at} configFields` });
    }
  }
  return out;
}
