// Deterministic protocol test for the unified chat agent: scripted model (no network, no spend) through the REAL unifiedResponse
// (tools, strict/fallback, trace, data-chat-result shape). It proves plumbing, NOT answer quality.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; process.env.BETTER_AUTH_SECRET ??= "x".repeat(32); process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
await import("../../plugins");
const { unifiedResponse } = await import("../../app/api/workflow-chat/unified");
const route = (name: string, model: string) => ({ name, model, apiKey: "k", baseURL: "u", maxTokens: 1000 }) as any;
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const textStream = (t: string) => [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: t }, { type: "text-end", id: "x" }, { type: "finish", finishReason: "stop", usage }];
const callStream = (name: string, input: object) => [{ type: "stream-start", warnings: [] }, { type: "tool-call", toolCallId: "c" + Math.random(), toolName: name, input: JSON.stringify(input) }, { type: "finish", finishReason: "tool-calls", usage }];
const mk = (steps: (object[] | Error)[]) => { let n = 0; return ({ specificationVersion: "v2", provider: "mock", modelId: "mock", supportedUrls: {}, doGenerate: async () => { throw new Error("n/a"); }, doStream: async () => { const s = steps[Math.min(n++, steps.length - 1)]; if (s instanceof Error) throw s; return { stream: new ReadableStream({ start(c) { for (const ch of s) c.enqueue(ch); c.close(); } }) } as any; } }) as any; };
async function run(label: string, models: Record<string, any>, selection: any, extra: any = {}) {
  const saved: string[] = [];
  const res = await unifiedResponse({ userId: "u", workflowId: "w", text: "hola", canvas: null, past: [], snapshotText: "The canvas is empty.", templates: [], selection, draftMode: false, ...extra,
    deps: { model: (rt: any) => models[rt.model], append: async (_u: string, _w: string, _r: string, c: string) => { saved.push(c); }, catalogText: async () => "CATALOG", connectionStatuses: async () => ({ tiendanube: "not_connected", firecrawl: "connected" }), discover: async (x: any) => x.catalog === "tools" ? { items: [{ slug: "NOTION_CREATE_PAGE", name: "Create page", description: "d", input_parameters: { properties: { title: { type: "string" } }, required: ["title"] } }] } : { items: [{ slug: "notion", name: "Notion", meta: { description: "notes" } }] }, connectOutcome: async (_u: string, a: string) => a === "tiendanube" ? { kind: "manual", name: "Tienda Nube", fields: ["Store ID", "Access token"] } : a === "gmail" ? { kind: "card", card: { toolkitId: "gmail", title: "Read Gmail" } } : { kind: "unknown_app" } } });
  const body = await res.text(); const events = body.split("\n").filter(l => l.startsWith("data: ")).map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const text = events.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join(""); const result = events.find((e: any) => e.type === "data-chat-result")?.data; const err = events.find((e: any) => e.type === "data-chat-error")?.data?.error; const trace = events.find((e: any) => e.type === "data-model-trace")?.data;
  console.log(`\n== ${label}\ntext: ${JSON.stringify(text)}\nresult: ${JSON.stringify(result)}\nerror: ${err ?? "-"}\ntrace: ${trace ? JSON.stringify({ used: trace.used, fellBack: trace.fellBack, strict: trace.strict }) : "-"}\nsaved: ${JSON.stringify(saved)}`);
  return { text, result, err, trace, events };
}
const auto = (routes: any[]) => ({ ok: true, routes, strict: false, choice: "auto" });
const strict = (routes: any[]) => ({ ok: true, routes, strict: true, choice: "g" });
const PLAN = "Trigger Manual; Tienda Nube: list the last 3 products; Firecrawl search for info on each; AI step writes a 3-video script; fal generate-video x3 vertical 9:16; final result: three video URLs.";
const multi = (calls: [string, object][]) => [{ type: "stream-start", warnings: [] }, ...calls.map(([n, i]) => ({ type: "tool-call", toolCallId: "c" + Math.random(), toolName: n, input: JSON.stringify(i) })), { type: "finish", finishReason: "tool-calls", usage }];
let a = await run("A same agent builds: start_build -> builder tools -> validators -> guide", { m1: mk([callStream("start_build", { plan: PLAN }), multi([["set_name", { name: "Videos" }], ["add_node", { id: "t", nodeType: "trigger", label: "Manual", actionType: "Manual" }], ["add_node", { id: "tn", nodeType: "action", label: "Productos Tiendanube", actionType: "tiendanube/list-products" }], ["connect", { source: "t", target: "tn" }]]), textStream("Armé los pasos.")]) }, auto([route("gemini", "m1")]));
{ const ev = a.events; const fin = ev.find((e: any) => e.type === "data-canvas-final")?.data; const ops = ev.filter((e: any) => e.type === "data-canvas-op").length;
  console.log("CHECK A:", fin && fin.nodes.length === 2 && fin.edges.length === 1 && ops >= 4 && a.result?.unified === true && a.result?.built === true && a.result?.build === null ? "PASS" : "FAIL", JSON.stringify({ nodes: fin?.nodes?.length, edges: fin?.edges?.length, ops, validation: fin?.validation?.length })); }
let b = await run("B manual-app connection gives no card, model is told", { m1: mk([callStream("request_connection", { app: "tiendanube" }), textStream("Conectá Tienda Nube desde Conexiones.")]) }, auto([route("gemini", "m1")]));
console.log("CHECK B:", b.result?.connect === null && /Conexiones/.test(b.text) ? "PASS" : "FAIL");
let c = await run("C card for composio preset", { m1: mk([callStream("request_connection", { app: "gmail" }), textStream("Conectá Gmail.")]) }, auto([route("gemini", "m1")]));
console.log("CHECK C:", (c.result?.connect as any)?.toolkitId === "gmail" ? "PASS" : "FAIL");
let d = await run("D strict: failing model => explicit error, NO other model used", { m1: mk([Object.assign(new Error("boom"), { statusCode: 503 })]), m2: mk([textStream("fallback answered")]) }, strict([route("gemini", "m1")]));
console.log("CHECK D:", d.err && /gemini\/m1/.test(d.err) && /503/.test(d.err) && !d.text ? "PASS" : "FAIL");
let e = await run("E auto: first route fails, second answers, fallback is traced", { m1: mk([Object.assign(new Error("429"), { statusCode: 429 })]), m2: mk([textStream("respondí yo")]) }, auto([route("gemini", "m1"), route("openrouter", "m2")]));
console.log("CHECK E:", e.text === "respondí yo" && e.trace?.fellBack === true && e.trace?.used === "openrouter/m2" ? "PASS" : "FAIL");
let f = await run("F draft mode refuses connection card", { m1: mk([callStream("request_connection", { app: "gmail" }), textStream("Sigo en borrador.")]) }, auto([route("gemini", "m1")]), { draftMode: true });
console.log("CHECK F:", f.result?.connect === null ? "PASS" : "FAIL");
let g = await run("G build_done event: review block reaches the model, no user turn added", { m1: mk([textStream("Armé el flujo. Revisá el prompt.")]) }, auto([route("gemini", "m1")]), { text: "", event: "build_done", review: { steps: [{ label: "Escribir guion", app: "ai-gateway", aiPrompt: "Escribí un guion de 15s" }], placeholders: [] } });
console.log("CHECK G:", g.text.length > 0 && g.result?.build === null ? "PASS" : "FAIL");

let h = await run("H live discovery of an external app", { m1: mk([callStream("lookup_app_actions", { toolkit: "notion" }), textStream("Veo NOTION_CREATE_PAGE.")]) }, auto([route("gemini", "m1")]));
console.log("CHECK H:", /NOTION/.test(h.text) ? "PASS" : "FAIL");
const buildNoVideo = [callStream("start_build", { plan: "Manual; Tiendanube list products; AI writes 3 scripts" }), multi([["add_node", { id: "t", nodeType: "trigger", label: "Manual", actionType: "Manual" }], ["add_node", { id: "tn", nodeType: "action", label: "Productos", actionType: "tiendanube/list-products" }], ["connect", { source: "t", target: "tn" }]]), textStream("ok")];
let i2 = await run("I plan dropped the requested video -> validator still flags it (user request, not plan)", { m1: mk(buildNoVideo) }, auto([route("gemini", "m1")]), { past: [{ role: "user", content: "Quiero que cree 3 videos verticales para publicidad" }, { role: "assistant", content: "Dale" }] });
{ const fin = i2.events.find((e: any) => e.type === "data-canvas-final")?.data; console.log("CHECK I:", fin?.validation?.some((v: string) => /video/.test(v)) ? "PASS" : "FAIL"); }
let j = await run("J asking for info ABOUT videos is not a request to generate them", { m1: mk(buildNoVideo) }, auto([route("gemini", "m1")]), { past: [{ role: "user", content: "Busca informacion sobre videos virales de cocina y mandame un resumen" }, { role: "assistant", content: "Dale" }] });
{ const fin = j.events.find((e: any) => e.type === "data-canvas-final")?.data; console.log("CHECK J:", !fin?.validation?.some((v: string) => /video/.test(v)) ? "PASS" : "FAIL"); }
let k = await run("K model dies (503) after building the trigger: interrupted + redacted build trace, not a silent success", { m1: mk([multi([["add_node", { id: "t", nodeType: "trigger", label: "Manual", actionType: "Manual" }]]), Object.assign(new Error("high demand"), { statusCode: 503 }), Object.assign(new Error("high demand"), { statusCode: 503 }), textStream("x")]) }, strict([route("gemini", "m1")]), { past: [{ role: "user", content: "armame un flujo" }, { role: "assistant", content: "dale" }] });
{ const fin = k.events.find((e: any) => e.type === "data-canvas-final")?.data; const tr = k.events.find((e: any) => e.type === "data-model-trace")?.data; console.log("CHECK K:", fin?.interrupted === true && tr?.build?.passes?.length >= 1 && tr.build.passes[0].finish === "error" && !JSON.stringify(tr).includes("armame") ? "PASS" : "FAIL", JSON.stringify(tr?.build ?? null).slice(0, 400)); }
