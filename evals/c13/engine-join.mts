// @ts-nocheck
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
    "ai-gateway/generate-text": async (i: any) => { prompts[`p${Object.keys(prompts).length}`] = String(i.aiPrompt); return { success: true, object: { titulo: "T", gancho: "G", guion: "S", textoEnPantalla: "X", visualPrompt: "V" } }; },
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
  { name: "S4 solo ML (TN count 0)", tn: 0, ml: 1, dTn: 20, dMl: 20 },
]) out.push(await run(sc));
for (const x of out) {
  console.log("\n=== " + x.sc.name); console.log(x.ev.join("\n"));
  const p = Object.values(x.prompts as Record<string, string>).filter((s, i) => Object.keys(x.prompts)[i].startsWith("p"));
  console.log("guion prompts:", p.length, "| literal {{@detail-tn en prompt:", p.some(s => s.includes("{{@detail-tn")), "| literal {{@detail-ml:", p.some(s => s.includes("{{@detail-ml")), "| contiene DESC-TN:", p.some(s => s.includes("DESC-TN")), "DESC-ML:", p.some(s => s.includes("DESC-ML")));
  const img = Object.entries(x.prompts).filter(([k]) => k.startsWith("img")).map(([, v]) => v), vid = Object.entries(x.prompts).filter(([k]) => k.startsWith("vid")).map(([, v]) => v);
  console.log("image prompts vacios (sin visualPrompt):", img.length, "->", JSON.stringify(img[0]?.slice(0, 40)), "| video:", JSON.stringify(vid[0]?.slice(0, 60)));
  console.log("approval message:", JSON.stringify(String(x.pending[0]?.message ?? "(no llego)").slice(0, 230)));
  console.log("success:", x.res?.success ?? JSON.stringify(x.res)?.slice(0, 120));
}
if (process.env.DBG) console.log(JSON.stringify(out[0].res, null, 1).slice(0, 2500));
