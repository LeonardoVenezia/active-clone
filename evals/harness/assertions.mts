// Pre-registered assertions over a saved run artifact (graph, configs, validator output, assistant text).
// Pure: the action output contract comes in as a parameter, so this runs offline on any saved artifact.
// Status: pass | fail | unknown (the contract cannot decide; never counted as fail) | na (does not apply to this run).
// `fail` is reserved for what the code proves: a missing node, a Loop source the engine cannot read, a field outside an
// EXACT contract. Plugin outputFields are free text and may be incomplete, so a field they do not list is `unknown`.
// Checks marked `signal` are heuristics (graph shape or regex over text): evidence, not proof that the flow works.
import { structuralViolations } from "../structural.mjs";

export type Status = "pass" | "fail" | "unknown" | "na";
export type CheckResult = { id: string; status: Status; detail: string; signal?: true };
export type CheckSpec = { id: string; term?: string; sources?: string[]; pattern?: string };
type Cfg = Record<string, unknown> & { actionType?: string; triggerType?: string; steps?: Step[]; source?: string; aiPrompt?: string };
export type Contract = {
  /** Declared (possibly incomplete) top-level output fields per action type. */
  outputFields: Record<string, string[]>;
  /** Declared (possibly incomplete) record fields of list outputs. */
  itemFields: Record<string, Record<string, string[]>>;
  /** EXACT top-level fields when the code fixes them (e.g. the AI text step), else undefined. */
  exact: (actionType: string, cfg: Cfg) => string[] | undefined;
};
type Step = { id?: string; actionType?: string; config?: Cfg };
type Node = { id: string; type?: string; data?: { label?: string; type?: string; config?: Cfg } };
export type Artifact = { final: { nodes: Node[]; edges: { source: string; target: string }[]; validation: string[]; timedOut?: boolean; interrupted?: boolean } | null; assistantText: string };

export const DEFAULT_CHECKS: CheckSpec[] = ["built", "completed", "validator_clean", "structural", "refs_resolve", "ref_fields_declared", "loop_sources_valid"].map((id) => ({ id }));
const SIGNALS = new Set(["ai_prompt_backed", "disclosed_if_dropped", "text_absent"]);

const REF = /\{\{@([^:}]+):([^}]*)\}\}/g;
// The engine only reads a Loop source that is exactly one template (lib/workflow-executor.workflow.ts, executeLoopNode).
const LOOP_SOURCE = /^\s*\{\{@([^:]+):([^}]+)\}\}\s*$/;
const cfgOf = (n: Node): Cfg => n.data?.config ?? {};
const AI = "ai-gateway/generate-text";

/** Every {{@id:Label.path}} in a value: referenced id and first field segment ("" when the whole output is referenced). */
function refsIn(v: unknown): { id: string; field: string }[] {
  return [...JSON.stringify(v ?? "").matchAll(REF)].map((m) => { const rest = m[2]; const dot = rest.indexOf("."); return { id: m[1], field: dot < 0 ? "" : rest.slice(dot + 1).split(/[.[]/)[0] }; });
}

/** Each place a config lives, with the ids it may legally reference besides top-level nodes. */
function scopes(nodes: Node[]) {
  const out: { owner: Node; step?: Step; cfg: Cfg; localIds: Set<string>; actionType: string }[] = [];
  for (const n of nodes) {
    const c = cfgOf(n);
    const { steps, ...own } = c;
    out.push({ owner: n, cfg: own as Cfg, localIds: new Set(), actionType: String(c.actionType ?? c.triggerType ?? "") });
    if (Array.isArray(steps)) steps.forEach((s, i) => out.push({ owner: n, step: s, cfg: s?.config ?? {}, localIds: new Set(["item", "index", ...steps.slice(0, i).map((x) => String(x?.id))]), actionType: String(s?.actionType ?? "") }));
  }
  return out;
}

/** Manual trigger inputs are exact (the app asks exactly these); other triggers are unknown. */
function triggerOutputs(n: Node): string[] | undefined {
  return cfgOf(n).triggerType === "Manual" ? ((cfgOf(n).inputFields as { key?: string }[] | undefined) ?? []).map((f) => String(f.key)) : undefined;
}

/**
 * Action types whose data reaches an AI step through template references: what its prompt references, then what those steps
 * reference, transitively (a Loop brings its inner steps). A SIGNAL: a reference chain is not a guarantee the values arrive at run time.
 */
function dataSourcesOf(nodes: Node[], owner: Node, step: Step | undefined): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n])); const types = new Set<string>(); const seen = new Set<string>();
  const inner = new Map((cfgOf(owner).steps ?? []).map((s) => [String(s?.id), s]));
  const stack = refsIn(step ? step.config : (({ steps, ...own }) => own)(cfgOf(owner))).map((r) => r.id);
  while (stack.length) {
    const id = stack.pop() as string; if (seen.has(id)) continue; seen.add(id);
    const s = step ? inner.get(id) : undefined;
    if (s) { types.add(String(s.actionType)); stack.push(...refsIn(s.config).map((r) => r.id)); continue; }
    const n = byId.get(id); if (!n) continue;
    types.add(String(cfgOf(n).actionType ?? cfgOf(n).triggerType));
    for (const x of cfgOf(n).steps ?? []) types.add(String(x?.actionType));
    stack.push(...refsIn(cfgOf(n)).map((r) => r.id));
  }
  return types;
}

/** AI text steps whose prompt mentions `term`, and whether a step of one of `sources` feeds their prompt through references. */
function aiMentions(a: NonNullable<Artifact["final"]>, term: string, sources: string[]) {
  const re = new RegExp(term, "i"); const out: { where: string; backed: boolean }[] = [];
  for (const s of scopes(a.nodes)) {
    if (s.actionType !== AI || !re.test(String(s.cfg.aiPrompt ?? ""))) continue;
    const fed = dataSourcesOf(a.nodes, s.owner, s.step);
    out.push({ where: s.step ? `${s.owner.id}/${s.step.id}` : s.owner.id, backed: sources.some((t) => fed.has(t)) });
  }
  return out;
}

export function evaluate(kase: { expect?: unknown }, specs: CheckSpec[], a: Artifact, k: Contract): CheckResult[] {
  const f = a.final;
  const r = (id: string, status: Status, detail = ""): CheckResult => ({ id, status, detail, ...(SIGNALS.has(id) ? { signal: true as const } : {}) });
  return specs.map((s): CheckResult => {
    if (s.id === "completed") return r(s.id, f && !f.timedOut && !f.interrupted ? "pass" : "fail", f ? `timedOut=${!!f.timedOut} interrupted=${!!f.interrupted}` : "no build");
    if (s.id === "text_absent") return r(s.id, new RegExp(String(s.pattern), "i").test(a.assistantText) ? "fail" : "pass");
    if (!f) return r(s.id, s.id === "built" ? "fail" : "na", "no build in this run");
    const nodeIds = new Set(f.nodes.map((n) => n.id));
    switch (s.id) {
      case "built": { const t = f.nodes.filter((n) => n.data?.type === "trigger").length; const acts = f.nodes.length - t; return r(s.id, t === 1 && acts >= 1 ? "pass" : "fail", `triggers=${t} actions=${acts}`); }
      case "validator_clean": return r(s.id, f.validation.length ? "fail" : "pass", f.validation.map((v) => v.slice(0, 160)).join(" | "));
      case "structural": { const v = structuralViolations(kase, f); return r(s.id, v.length ? "fail" : "pass", v.join("; ")); }
      case "refs_resolve": {
        const bad = scopes(f.nodes).flatMap((sc) => refsIn(sc.cfg).filter((x) => !nodeIds.has(x.id) && !sc.localIds.has(x.id)).map((x) => `${sc.step ? `${sc.owner.id}/${sc.step.id}` : sc.owner.id} -> ${x.id}`));
        return r(s.id, bad.length ? "fail" : "pass", bad.join("; "));
      }
      case "ref_fields_declared": {
        const bad: string[] = []; const unk: string[] = [];
        for (const sc of scopes(f.nodes)) for (const x of refsIn(sc.cfg)) {
          if (!x.field || sc.localIds.has(x.id)) continue; // whole output, or item/index/inner step: not covered by any contract here
          const n = f.nodes.find((y) => y.id === x.id); if (!n) continue; // refs_resolve reports it
          const at = String(cfgOf(n).actionType ?? cfgOf(n).triggerType ?? "");
          const exact = n.data?.type === "trigger" ? triggerOutputs(n) : k.exact(at, cfgOf(n));
          if (exact) { if (!exact.includes(x.field)) bad.push(`${x.id}.${x.field} (exact: ${exact.join(", ") || "none"})`); continue; }
          if (!k.outputFields[at]?.includes(x.field)) unk.push(`${x.id}.${x.field}${k.outputFields[at] ? ` (not in the declared list: ${k.outputFields[at].join(", ")})` : " (no declared outputs)"}`);
        }
        return r(s.id, bad.length ? "fail" : unk.length ? "unknown" : "pass", [...bad, ...unk].join("; "));
      }
      case "loop_sources_valid": {
        const loops = f.nodes.filter((n) => cfgOf(n).actionType === "Loop"); if (!loops.length) return r(s.id, "na", "no Loop");
        const res = loops.map((l): { st: Status; d: string } => {
          const m = LOOP_SOURCE.exec(String(cfgOf(l).source ?? ""));
          if (!m) return { st: "fail", d: `${l.id}: the engine reads only a source that is exactly one reference (${String(cfgOf(l).source ?? "").slice(0, 80)})` };
          const field = refsIn(m[0])[0].field; const n = f.nodes.find((y) => y.id === m[1]);
          if (!n) return { st: "fail", d: `${l.id}: source node ${m[1]} missing` };
          const at = String(cfgOf(n).actionType ?? "");
          const exact = k.exact(at, cfgOf(n));
          // An AI text step returns a string or an object of scalar fields (lib/agent/output-contract.ts), never a list.
          if (at === AI) return { st: "fail", d: `${l.id}: source is an AI text step, which never returns a list` };
          if (exact && !exact.includes(field)) return { st: "fail", d: `${l.id}: ${at} returns exactly ${exact.join(", ")}, not "${field}"` };
          if (exact) return { st: "unknown", d: `${l.id}: ${at}.${field} exists, but its shape depends on the step (not checked)` };
          if (k.itemFields[at] && field in k.itemFields[at]) return { st: "pass", d: `${l.id}: ${at}.${field} is a declared list` };
          return { st: "unknown", d: `${l.id}: ${at}.${field} is not declared as a list (declarations may be incomplete)` };
        });
        return r(s.id, res.some((x) => x.st === "fail") ? "fail" : res.some((x) => x.st === "unknown") ? "unknown" : "pass", res.map((x) => x.d).join("; "));
      }
      case "ai_prompt_backed": {
        const m = aiMentions(f, String(s.term), s.sources ?? []); if (!m.length) return r(s.id, "pass", `no AI prompt mentions /${s.term}/`);
        const bad = m.filter((x) => !x.backed);
        return r(s.id, bad.length ? "fail" : "pass", `${bad.length ? "no reference chain from a source step" : "reference chain from a source step"}: ${(bad.length ? bad : m).map((x) => x.where).join(", ")}`);
      }
      case "disclosed_if_dropped": {
        const m = aiMentions(f, String(s.term), s.sources ?? []);
        if (m.length && m.every((x) => x.backed)) return r(s.id, "na", "the graph references a source for it");
        const said = new RegExp(String(s.pattern), "i").test(a.assistantText);
        return r(s.id, said ? "pass" : "fail", `no referenced source for /${s.term}/; assistant text ${said ? "mentions it with a negation" : "does not mention it with a negation"}`);
      }
      default: return r(s.id, "unknown", "unknown check id");
    }
  });
}
