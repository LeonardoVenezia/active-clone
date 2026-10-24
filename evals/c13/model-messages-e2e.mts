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
    deps: { loadTemplate: async () => (globalThis as any).__tpl ?? null, model: (rt: any) => models[rt.model], append: async (_u: string, _w: string, _r: string, c: string) => { saved.push(c); }, judge: async (_m: any, msgs: string[], kinds: string[]) => (extra.judgeFn ? extra.judgeFn(msgs, kinds) : Object.fromEntries(kinds.map(k => [k, "wanted"]))), catalogText: async () => "CATALOG", connectionStatuses: async () => ({ tiendanube: "not_connected", firecrawl: "connected" }), discover: async (x: any) => x.catalog === "tools" ? { items: [{ slug: "NOTION_CREATE_PAGE", name: "Create page", description: "d", input_parameters: { properties: { title: { type: "string" } }, required: ["title"] } }] } : { items: [{ slug: "notion", name: "Notion", meta: { description: "notes" } }] }, connectOutcome: async (_u: string, a: string) => a === "tiendanube" ? { kind: "manual", name: "Tienda Nube", fields: ["Store ID", "Access token"] } : a === "gmail" ? { kind: "card", card: { toolkitId: "gmail", title: "Read Gmail" } } : { kind: "unknown_app" } } });
  const body = await res.text(); const events = body.split("\n").filter(l => l.startsWith("data: ")).map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const text = events.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join(""); const result = events.find((e: any) => e.type === "data-chat-result")?.data; const err = events.find((e: any) => e.type === "data-chat-error")?.data?.error; const trace = events.find((e: any) => e.type === "data-model-trace")?.data;
  console.log(`\n== ${label}\ntext: ${JSON.stringify(text)}\nresult: ${JSON.stringify(result)}\nerror: ${err ?? "-"}\ntrace: ${trace ? JSON.stringify({ used: trace.used, fellBack: trace.fellBack, strict: trace.strict }) : "-"}\nsaved: ${JSON.stringify(saved)}`);
  return { text, result, err, trace, events };
}
const auto = (routes: any[]) => ({ ok: true, routes, strict: false, choice: "auto" });
const strict = (routes: any[]) => ({ ok: true, routes, strict: true, choice: "g" });
const PLAN = "Trigger Manual; Tienda Nube: list the last 3 products; Firecrawl search for info on each; AI step writes a 3-video script; fal generate-video x3 vertical 9:16; final result: three video URLs.";
const multi = (calls: [string, object][]) => [{ type: "stream-start", warnings: [] }, ...calls.map(([n, i]) => ({ type: "tool-call", toolCallId: "c" + Math.random(), toolName: n, input: JSON.stringify(i) })), { type: "finish", finishReason: "tool-calls", usage }];
const tplNodes = [{ id: "trigger-1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Inicio", type: "trigger", config: { actionType: "Manual" } } }, { id: "get-product", type: "action", position: { x: 200, y: 0 }, data: { label: "Producto", type: "action", config: { actionType: "tiendanube/get-product", productId: "{{@trigger-1:Inicio.productId}}", integrationId: "SECRET-CONN" } } }];
(globalThis as any).__tpl = { name: "Plantilla", nodes: tplNodes, edges: [{ id: "e1", source: "trigger-1", target: "get-product" }] };

const bt = (x: any) => x.events.find((e: any) => e.type === "data-model-trace")?.data?.build ?? x.trace?.build;
let S = await run("S2 template import then corrective + guide passes (tool output must stay SDK-valid)", { m1: mk([callStream("use_template", { id: "t1", import: true }), textStream("Importé la plantilla."), textStream("Corregí."), textStream("Listo.")]) }, strict([route("gemini", "m1")]), { templates: [{ id: "t1", name: "Plantilla", description: "d" }], past: [{ role: "user", content: "Quiero que cada día tome mis productos y genere 3 videos verticales" }, { role: "assistant", content: "Dale" }] });
const b = bt(S); const stages = (b?.passes ?? []).map((p: any) => `${p.stage}:${p.finish}`);
console.log("passes:", stages.join(" "), "close:", b?.closeReason, "err:", JSON.stringify((b?.passes ?? []).map((p: any) => p.error?.note).filter(Boolean)));
const okAll = b && b.closeReason !== "corrective-failed" && !(b.passes ?? []).some((p: any) => p.finish === "error") && (b.passes ?? []).some((p: any) => String(p.stage).startsWith("corrective"));
console.log("CHECK S2:", okAll ? "PASS" : "FAIL");
process.exit(okAll ? 0 : 1);
