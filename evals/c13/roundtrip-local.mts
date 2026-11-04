// @ts-nocheck
// Offline, no model calls, no network. Reproduces how the REAL executor (lib/workflow-executor.workflow.ts processTemplates, sliced from source)
// treats Datos config shapes, then applies the result with the real Datos core on the in-memory repo.
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync } from "node:fs"; import ts from "typescript";
const r = createRequire(import.meta.url);
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (/^server-only$/.test(q)) return r.resolve("typescript"); return o.call(this, q, ...a); };
process.env.DATOS_STORAGE_ENABLED = "true";
const src = readFileSync(new URL("../../lib/workflow-executor.workflow.ts", import.meta.url), "utf8");
const a = src.indexOf("const JSON_STRING_CONFIG_KEYS"); const b = src.indexOf("/**\n * Main workflow executor function");
if (a < 0 || b < 0) { console.log("FAIL could not slice processTemplates from the executor"); process.exit(1); }
const js = ts.transpileModule(src.slice(a, b), { compilerOptions: { target: "ES2022" } }).outputText;
const { resolveFieldValue } = await import("../../lib/field-path");
const { jsonFormatTag } = await import("../../lib/datos/value-format");
const processTemplates = new Function("resolveFieldValue", "datosJsonFormatTag", js + "\nreturn processTemplates;")(resolveFieldValue, jsonFormatTag);
const core: any = await import("../../lib/datos/core"); const { datosApplyTogether, datosRead, memoryRepo } = core.default ?? core;
const bc: any = await import("../../lib/agent/build-core"); const { shadowApply } = bc.default ?? bc;
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; process.env.BETTER_AUTH_SECRET ??= "x".repeat(32); process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
await import("../../plugins");
const { unifiedResponse } = await import("../../app/api/workflow-chat/unified");
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const textStream = (t: string) => [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: t }, { type: "text-end", id: "x" }, { type: "finish", finishReason: "stop", usage }];
const multi = (calls: [string, object][]) => [{ type: "stream-start", warnings: [] }, ...calls.map(([n, i]) => ({ type: "tool-call", toolCallId: "c" + Math.random(), toolName: n, input: JSON.stringify(i) })), { type: "finish", finishReason: "tool-calls", usage }];
let streams = 0; const mk = (steps: any[]) => { let n = 0; return { specificationVersion: "v2", provider: "mock", modelId: "mock", supportedUrls: {}, doGenerate: async () => { throw new Error("n/a"); }, doStream: async () => { streams++; const s = steps[Math.min(n++, steps.length - 1)]; return { stream: new ReadableStream({ start(c) { for (const ch of s) c.enqueue(ch); c.close(); } }) } as any; } } as any; };
const run = async (text: string, steps: any[], canvas: any = null) => { streams = 0; const res = await unifiedResponse({ userId: "u", workflowId: "w", text, canvas, past: [], snapshotText: "The canvas is empty.", templates: [], selection: { ok: true, routes: [{ name: "r", model: "m", apiKey: "k", baseURL: "u", maxTokens: 1000 }], strict: false, choice: "auto" }, draftMode: false, deps: { loadTemplate: async () => null, model: () => mk(steps), append: async () => {}, judge: async (_m: any, _x: string[], kinds: string[]) => Object.fromEntries(kinds.map((k) => [k, "wanted"])), catalogText: async () => "CATALOG", connectionStatuses: async () => ({}) } } as any);
  const events = (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  return { text: events.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join(""), fin: events.find((e: any) => e.type === "data-canvas-final")?.data, result: events.find((e: any) => e.type === "data-chat-result")?.data, streams }; };
const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/datos-graphs/${n}.json`, import.meta.url), "utf8"));
// Scope: offline, in-memory. The PATCH route (app/api/workflows/[workflowId]/route.ts) needs db/auth and its buildUpdateData is not exported, so it is NOT imported:
// persistence is modelled only as JSON serialization (what a jsonb column returns), which is stated, not proven against Postgres.
// ---- 1. Tags survive a store/load round trip and still gate typed substitution; an edit invalidates them
const g22 = fx("c22-saveifabsent-gate-creado");
const stored = JSON.parse(JSON.stringify(g22));
ok(JSON.stringify(stored) === JSON.stringify(g22), "round trip (JSON serialize/parse): graph identical");
const datosNodes = stored.nodes.filter((n: any) => n.data?.config?.actionType === "Datos");
const tagged = datosNodes.flatMap((n: any) => Object.keys(n.data.config).filter((k) => /Format$/.test(k)).map((k) => [n, k]));
ok(tagged.length > 0, `fixture has Datos format tags (${tagged.map(([, k]: any) => k).join(",")})`);
ok(tagged.every(([n, k]: any) => n.data.config[k] === jsonFormatTag(n.data.config[k.replace(/Format$/, "")])), "after the round trip each tag still matches its exact text");
const [n0, k0]: any = tagged[0]; const fld = k0.replace(/Format$/, "");
const ref = (n0.data.config[fld].match(/\{\{@([^:}]+):([^.}]+)\.([^}]+)\}\}/) || []);
const out: any = {}; if (ref[1]) out[ref[1]] = { label: ref[2], data: new Proxy({}, { get: () => 7 }) };
const applied: any = processTemplates({ ...n0.data.config }, out);
ok(applied[k0] === "json", "stored tagged config: executor keeps the json flag (typed substitution active)");
const edited: any = processTemplates({ ...n0.data.config, [fld]: n0.data.config[fld] + " " }, out);
ok(edited[k0] === undefined, "same config after an edit to the text (a UI or API edit that leaves the tag behind): flag dropped, legacy path");
const noRoute = { ...n0.data.config }; delete noRoute[k0];
ok(processTemplates(noRoute, out)[k0] === undefined, "a client that drops unknown keys on save (hypothetical): flag absent, legacy path, no crash");
// ---- 2. Turn end vs canvas. Real unifiedResponse with a scripted model; the client's finalizeUnified is a closure inside a React component and is NOT importable.
const pre = { nodes: [{ id: "m", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Manual", type: "trigger", config: { triggerType: "Manual" } } }, { id: "sl", type: "action", position: { x: 200, y: 0 }, data: { label: "Aviso", type: "action", config: { actionType: "slack/send-message", slackChannel: "#a", slackMessage: "original" } } }], edges: [{ id: "e-m-sl", source: "m", target: "sl" }] };
const C21 = "Cuando llegue un pedido pagado de Tiendanube, descontá del saldo de cada producto la cantidad vendida en los datos de la empresa y registrá el movimiento";
const edit = multi([["update_parameters", { nodeId: "sl", config: { slackMessage: "editado" } }]]);
const lim = multi([["update_parameters", { nodeId: "sl", config: { slackMessage: "editado" } }], ["add_node", { id: "loop", nodeType: "action", label: "Loop", actionType: "Loop", config: { source: "{{@m:Manual.items}}", maxItems: 5, steps: [{ id: "s", actionType: "slack/send-message", config: { slackChannel: "#g", slackMessage: "x" } }] } }], ["connect", { source: "m", target: "loop" }]]);
const L = await run(C21, [lim, textStream("Listo")], JSON.parse(JSON.stringify(pre)));
ok(L.fin?.unsupportedLimit === true && JSON.stringify(L.fin.nodes) === JSON.stringify(pre.nodes) && JSON.stringify(L.fin.edges) === JSON.stringify(pre.edges), "limit turn with a pre-existing canvas: server returns the exact pre-turn canvas (graph rollback by returned snapshot)");
const E = await run("Mandame un resumen por Slack", [edit, textStream("Listo")], JSON.parse(JSON.stringify(pre)));
ok(E.fin?.nodes?.find((n: any) => n.id === "sl")?.data?.config?.slackMessage === "editado", "control: an ordinary turn does apply its edit (the restore above is not vacuous)");
const failing = { ...mk([]), doStream: async () => { throw new Error("provider failed mid-turn"); } };
let thrown = ""; let F2: any = null;
try { streams = 0; const res = await unifiedResponse({ userId: "u", workflowId: "w", text: "Mandame un resumen por Slack", canvas: JSON.parse(JSON.stringify(pre)), past: [], snapshotText: "x", templates: [], selection: { ok: true, routes: [{ name: "r", model: "m", apiKey: "k", baseURL: "u", maxTokens: 1000 }], strict: false, choice: "auto" }, draftMode: false, deps: { loadTemplate: async () => null, model: () => failing, append: async () => {}, judge: async () => ({}), catalogText: async () => "CATALOG", connectionStatuses: async () => ({}) } } as any);
  const ev = (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean); F2 = ev.find((e: any) => e.type === "data-canvas-final")?.data; } catch (e: any) { thrown = String(e?.message || e); }
console.log("INFO provider failure mid-turn:", thrown ? `unifiedResponse threw: ${thrown.slice(0, 80)}` : `canvas-final nodes=${F2?.nodes?.length} interrupted=${F2?.interrupted} unchanged=${F2 ? JSON.stringify(F2.nodes) === JSON.stringify(pre.nodes) : "n/a"}`);
ok(thrown !== "" || F2 == null, "provider failure on the first model call: no canvas-final is emitted, so nothing is applied by the client (client side by code read only)");
// ---- 3. Datos transaction (different thing): applyTogether is all-or-none in the repo; it does not touch the graph
const opsBad = [{ operation: "saveIfAbsent", collection: "movimientos", key: "tn:7:L1:venta", value: { sku: "S1" } }, { operation: "add", collection: "saldos", key: "S1", field: "stock", amount: "-9", min: "0" }];
const repo = memoryRepo(); await repo.insertIfAbsent("org", "saldos", "S1", { stock: 5 }, 5000);
const rb: any = await datosApplyTogether(repo, "org", { operations: opsBad, operationId: "o1" });
const mv: any = await datosRead(repo, "org", { collection: "movimientos", key: "tn:7:L1:venta" }); const sd: any = await datosRead(repo, "org", { collection: "saldos", key: "S1" });
ok(rb.estado === "rechazado" && !mv.record && sd.record?.value?.stock === 5, `Datos transaction: insufficient stock rejects the whole set; movement not written, stock stays 5 (estado=${rb.estado})`);
console.log("NOTE: the client's PATCH of nodes/edges is a plain overwrite (code read of route.ts: updateData.nodes = body.nodes); the product offers no multi-record or graph transaction, and none is tested here.");
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log("done");
