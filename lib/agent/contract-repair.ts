// Deterministic, EXACT repairs of output-contract path mistakes (the builder knows the contract, the model should not have to guess it).
// Only rewrites a reference when the right path is unambiguous from the graph itself:
//  - AI step with aiFormat "object" and a VALID aiSchema array: a read of `<name>` (or steps.<sid>.<name>) becomes `object.<name>`.
//  - Loop source `{{@F:Label.result.<key>}}` on a statically constant Fórmula whose result IS the list: becomes `.result`.
// Nothing else is touched (no invented fields, no edge changes). Returns how many references changed (metadata only).
import { AI_TEXT_ACTION, aiOutputOf, constantFormulaResult } from "@/lib/agent/output-contract";
import type { FlowNode } from "@/lib/flow-validator";

type Cfg = Record<string, unknown>;
const TPL = /\{\{@([\w-]+):([^}]*)\}\}/g;
const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "_");
const innerSteps = (cfg: Cfg | undefined) => (Array.isArray(cfg?.steps) ? (cfg!.steps as Array<{ id?: unknown; actionType?: unknown; config?: unknown }>) : []);
const aiNames = (c: unknown) => { const o = aiOutputOf(c as Cfg); return o.kind === "object" ? o.names : null; };
const actionOf = (n: FlowNode) => ((n.data?.config as Cfg | undefined)?.actionType as string | undefined) ?? "";

export function repairOutputContracts(nodes: FlowNode[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let changed = 0;
  const loopSrcId = (cfg: Cfg) => { const m = typeof cfg.source === "string" ? /^\s*\{\{@([\w-]+):[^}]*\.items\}\}\s*$/.exec(cfg.source) : null; return m?.[1]; };

  for (const n of nodes) {
    const cfg = n.data?.config as Cfg | undefined; if (!cfg) continue;
    const isLoop = actionOf(n) === "Loop";
    const srcLoop = isLoop ? byId.get(loopSrcId(cfg) ?? "") : undefined;
    const srcInners = srcLoop && actionOf(srcLoop) === "Loop" ? innerSteps(srcLoop.data?.config as Cfg) : [];
    const ownInners = isLoop ? innerSteps(cfg) : [];

    const fixTpl = (s: string, key: string): string => s.replace(TPL, (whole, id: string, rest: string) => {
      // Loop source over a constant list Fórmula
      const target = byId.get(id);
      if (target && key === "source" && isLoop && actionOf(target) === "Fórmula") {
        const label = target.data?.label ?? ""; const prefix = `${label}.`;
        if (label && rest.startsWith(prefix)) {
          const p = rest.slice(prefix.length); const m = /^result\.[A-Za-z0-9_]+$/.exec(p);
          const c = constantFormulaResult(target.data?.config as Cfg);
          if (m && c.known && Array.isArray(c.value)) { changed++; return `{{@${id}:${label}.result}}`; }
        }
        return whole;
      }
      // read of a declared AI object field directly on an AI node
      if (target && actionOf(target) === AI_TEXT_ACTION) {
        const label = target.data?.label ?? ""; const prefix = `${label}.`; const names = aiNames(target.data?.config);
        if (names && label && rest.startsWith(prefix)) {
          const p = rest.slice(prefix.length); const first = p.split(/[.[]/)[0];
          if (names.includes(first)) { changed++; return `{{@${id}:${label}.object.${p}}}`; }
        }
        return whole;
      }
      // {{@item:Item.steps.<sid>.<f>}} over another Loop's items
      if (id === "item" && rest.startsWith("Item.steps.") && srcInners.length) {
        const p = rest.slice("Item.steps.".length); const sid = p.split(".")[0]; const f = p.slice(sid.length + 1);
        const st = srcInners.find((x, i) => sanitize(typeof x.id === "string" && x.id ? x.id : `step-${i + 1}`) === sid);
        const names = st?.actionType === AI_TEXT_ACTION ? aiNames(st.config) : null;
        if (names && names.includes(f.split(/[.[]/)[0])) { changed++; return `{{@item:Item.steps.${sid}.object.${f}}}`; }
        return whole;
      }
      // sibling inner step by id inside this Loop
      if (!target && ownInners.length) {
        const st = ownInners.find((x) => x.id === id);
        const names = st?.actionType === AI_TEXT_ACTION ? aiNames(st.config) : null;
        if (names) {
          const dot = rest.indexOf("."); const p = dot >= 0 ? rest.slice(dot + 1) : "";
          if (p && names.includes(p.split(/[.[]/)[0])) { changed++; return `{{@${id}:${rest.slice(0, dot)}.object.${p}}}`; }
        }
      }
      return whole;
    });

    const walk = (v: unknown, key: string): unknown => {
      if (typeof v === "string") {
        let out = v.includes("{{@") ? fixTpl(v, key) : v;
        if (key === "expression" && actionOf(n) === "Fórmula" && typeof cfg.input === "string") {
          for (const lm of cfg.input.matchAll(/\{\{@([\w-]+):[^}]*\.items\}\}/g)) {
            const ln = byId.get(lm[1]); if (!ln || actionOf(ln) !== "Loop") continue;
            const inners = innerSteps(ln.data?.config as Cfg);
            out = out.replace(/\bsteps\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g, (w, sid: string, f: string) => {
              const st = inners.find((x, i) => sanitize(typeof x.id === "string" && x.id ? x.id : `step-${i + 1}`) === sid);
              const names = st?.actionType === AI_TEXT_ACTION ? aiNames(st.config) : null;
              if (names && names.includes(f)) { changed++; return `steps.${sid}.object.${f}`; }
              return w;
            });
          }
        }
        return out;
      }
      if (Array.isArray(v)) return v.map((x) => walk(x, key));
      if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v as object)) o[k] = walk(x, k); return o; }
      return v;
    };
    const next = walk(cfg, "") as Cfg;
    for (const k of Object.keys(next)) cfg[k] = next[k];
  }
  return changed;
}
