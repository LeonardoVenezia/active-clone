// Offline: Loop source pointing at a Formula value; engine resolution proven with the real resolveFieldValue semantics (copied contract) + repair.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
const m: any = await import("../../lib/agent/build-core"); const { fixFormulaRefsIn } = m.default ?? m;
const mk = (source: string, extra: any = {}) => ({ nodes: [
  { id: "f", data: { label: "F", config: { actionType: "Fórmula", expression: "[1,2]" } } },
  { id: "l", data: { label: "L", config: { actionType: "Loop", source, steps: [], ...extra } } },
  { id: "l2", data: { label: "L2", config: { actionType: "Loop", source: "{{@l:L.items}}", steps: [{ id: "x", config: { aiPrompt: "{{@item:Item.item.numero}} {{@item:Item.steps.guion.text}}" } }] } } },
], edges: [] });
const res: [string, boolean][] = [];
let s: any = mk("{{@f:F.result.result}}"); let n = fixFormulaRefsIn(s);
res.push(["Loop source .result.result -> .result", s.nodes[1].data.config.source === "{{@f:F.result}}" && n === 1]);
s = mk("{{@f:F.result}}"); n = fixFormulaRefsIn(s); res.push(["correct .result untouched", s.nodes[1].data.config.source === "{{@f:F.result}}" && n === 0]);
s = mk("{{@f:F.result.items}}"); n = fixFormulaRefsIn(s); res.push(["field inside result untouched", s.nodes[1].data.config.source === "{{@f:F.result.items}}"]);
s = mk("{{@other:O.result.result}}"); n = fixFormulaRefsIn(s); res.push(["non-formula source untouched", s.nodes[1].data.config.source === "{{@other:O.result.result}}"]);
res.push(["nested loop item/steps refs untouched", JSON.stringify(s.nodes[2].data.config).includes("Item.item.numero") && JSON.stringify(s.nodes[2].data.config).includes("Item.steps.guion.text")]);
let f = 0; for (const [k, ok] of res) { console.log(ok ? "PASS" : "FAIL", k); if (!ok) f++; } process.exit(f ? 1 : 0);
