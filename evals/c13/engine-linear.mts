// @ts-nocheck
// Variant of engine-join.mts for the REPAIRED linear-spine graph (evals/c13/fixtures/linear-spine-graph.json): same real executeWorkflow, local handlers, generic checks. Simulation of handlers, not an integration run.
// Offline: REAL executeWorkflow (lib/workflow-executor.workflow.ts) with local handlers (no APIs/models/DB). Only the registry, the workflow SDK,
// trigger/approval persistence and step logging are stubbed. Reproduces branch/join order on the saved PROD QA graph with controlled delays.
import Module from "node:module"; import { createRequire } from "node:module"; import fs from "node:fs";
const r = createRequire(import.meta.url); const st = (n: string) => r.resolve(`../../evals/c13/stubs/${n}.ts`);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/step-registry$/, st("engine-step-registry")], [/^workflow$/, st("engine-workflow")], [/steps\/trigger$/, st("engine-trigger")], [/steps\/approval$/, st("engine-approval")], [/step-handler$/, st("engine-step-handler")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
const ex: any = await import("../../lib/workflow-executor.workflow"); const { executeWorkflow } = ex.default ?? ex;
const graph = JSON.parse(fs.readFileSync(process.argv[2] ?? "/tmp/prodgraph.json", "utf8"));
if (process.env.FIX) { const n = graph.nodes.find((x: any) => x.id === "loop-guiones"); n.data.config.source = "{{@angulos:Los 3 ángulos.result}}"; } // TEST-ONLY variant: Loop source pointed at .result (the Formula returns the array itself)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Sc = { name: string; tn: number; ml: number; dTn: number; dMl: number; approveDelay?: number; txtDelay?: number };
async function run(sc: Sc) {
  const t0 = Date.now(); const ev: string[] = []; const log = (s: string) => ev.push(`${String(Date.now() - t0).padStart(4)}ms ${s}`);
  (globalThis as any).__pending = []; (globalThis as any).__hookMeta = []; (globalThis as any).__approveDelay = sc.approveDelay ?? 10;
  const prompts: Record<string, string> = {};
  const H: any = {
    "tiendanube/list-products": async () => { await sleep(20); log("tn-products done"); return { success: true, count: sc.tn, products: sc.tn ? [{ id: 1, name: "Taza" }] : [] }; },
    "mercadolibre/list-items": async () => { await sleep(20); log("ml-items done"); return { success: true, count: sc.ml, items: sc.ml ? [{ id: "MLA1", title: "Taza ML" }] : [] }; },
    "tiendanube/get-product": async () => { log("detail-tn start"); await sleep(sc.dTn); log("detail-tn done"); return { success: true, id: 1, name: "Taza", description: "DESC-TN" }; },
    "mercadolibre/get-item": async () => { log("detail-ml start"); await sleep(sc.dMl); log("detail-ml done"); return { success: true, id: "MLA1", title: "Taza ML", description: "DESC-ML" }; },
    "perplexity/research": async (i: any) => { log("research start"); await sleep(20); log("research done"); return { success: true, data: { report: "REPORT" } }; },
    "ai-gateway/generate-text": async (i: any) => { prompts[`p${Object.keys(prompts).length}`] = String(i.aiPrompt); const okSchema = (() => { try { const a = typeof i.aiSchema === "string" ? JSON.parse(i.aiSchema) : i.aiSchema; return Array.isArray(a) && a.length > 0; } catch { return false; } })(); return i.aiFormat === "object" && i.aiSchema && okSchema ? { success: true, object: Object.fromEntries((typeof i.aiSchema === "string" ? JSON.parse(i.aiSchema) : i.aiSchema).map((f: any) => [f.name, `VAL_${f.name}`])) } : { success: true, text: "texto" }; },
    "fal/generate-image": async (i: any) => { prompts[`img${Object.keys(prompts).length}`] = String(i.prompt); return { success: true, data: { imageUrl: "u" } }; },
    "fal/generate-video": async (i: any) => { prompts[`vid${Object.keys(prompts).length}`] = String(i.prompt); return { success: true, data: { videoUrl: "v" } }; },
  };
  (globalThis as any).__H = H;
  const realLog = console.log; const realErr = console.error; console.log = () => {}; console.error = () => {};
  let res: any; try { res = await executeWorkflow({ nodes: graph.nodes, edges: graph.edges, triggerInput: { producto: "taza" }, workflowId: "w" }); } finally { console.log = realLog; console.error = realErr; }
  return { sc, ev, prompts, pending: (globalThis as any).__pending, meta: (globalThis as any).__hookMeta, res };
}
const out: any[] = [];
for (const sc of [
  { name: "S1 ambos, TN lento (detail-tn 200ms, detail-ml 10ms)", tn: 1, ml: 1, dTn: 200, dMl: 10 },
  { name: "S2 ambos, ML lento (detail-tn 10ms, detail-ml 200ms)", tn: 1, ml: 1, dTn: 10, dMl: 200 },
  { name: "S3 solo TN (ML count 0)", tn: 1, ml: 0, dTn: 20, dMl: 20 },
  { name: "S5 ninguno (TN 0, ML 0)", tn: 0, ml: 0, dTn: 20, dMl: 20 },
  { name: "S4 solo ML (TN count 0)", tn: 0, ml: 1, dTn: 20, dMl: 20 },
]) out.push(await run(sc));
for (const x of out) {
  console.log("\n=== " + x.sc.name); console.log(x.ev.join("\n"));
  const all = Object.entries(x.prompts) as [string, string][]; const app = String(x.pending[0]?.message ?? "");
  const lit = all.filter(([, v]) => v.includes("{{@")).map(([k]) => k);
  const guion = all.filter(([k]) => k.startsWith("p")).map(([, v]) => v);
  console.log("prompts total:", all.length, "| con plantilla literal:", JSON.stringify(lit), "| approval literal:", app.includes("{{@"), "| success:", x.res?.success);
  console.log("guion prompt contiene DESC-TN:", guion.some(v => v.includes("DESC-TN")), "DESC-ML:", guion.some(v => v.includes("DESC-ML")));
  if (process.env.SHOWP) { for (const [k, v] of all) if (k.startsWith("p") || k.startsWith("vid") || k.startsWith("img")) console.log("  ", k, JSON.stringify(v.slice(0, 420))); console.log("   research topic seen? (see prompts)"); }
  console.log("image/video prompts:", JSON.stringify(all.filter(([k]) => k.startsWith("img") || k.startsWith("vid")).map(([, v]) => v.slice(0, 40))));
  console.log("approval:", JSON.stringify(app.slice(0, 200)));
}
