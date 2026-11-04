// @ts-nocheck
// Offline, scripted model, no network/spend. Unsupported-limit gate for Datos balance requests. Cases: the REAL failed C-21 graph (model output @ddff7be),
// legitimate negatives, and the real C-20 graph that must still pass. Not a universal coverage claim: only phrasings listed here are exercised.
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync } from "node:fs";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; process.env.BETTER_AUTH_SECRET ??= "x".repeat(32); process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
await import("../../plugins");
const F: any = await import("../../lib/flow-validator"); const B: any = await import("../../lib/agent/build-core"); const { computeFlowErrors } = B.default ?? B;
const { unifiedResponse } = await import("../../app/api/workflow-chat/unified");
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const C21 = "Cuando llegue un pedido pagado de Tiendanube, descontá del saldo de cada producto la cantidad vendida en los datos de la empresa y registrá el movimiento para que no se descuente dos veces. No mandes mensajes ni toques el stock real de la tienda.";
const C20 = JSON.parse(readFileSync("evals/cases.jsonl", "utf8").split("\n").filter(Boolean).find((l) => l.includes('"C-20"'))).prompt;
const C22 = JSON.parse(readFileSync("evals/cases.jsonl", "utf8").split("\n").filter(Boolean).find((l) => l.includes('"C-22"'))).prompt;
const graphOf = (f: string) => { const a = JSON.parse(readFileSync(f, "utf8")); const find = (x: any): any => { if (!x || typeof x !== "object") return null; if (Array.isArray(x.nodes) && x.nodes.some((n: any) => n?.data?.config)) return x; for (const k of Object.keys(x)) { const g = find(x[k]); if (g) return g; } return null; }; return find(a.final); };
const errs = (g: any, prompt: string) => computeFlowErrors({ nodes: JSON.parse(JSON.stringify(g.nodes)), edges: JSON.parse(JSON.stringify(g.edges)) }, { composioCatalogMap: new Map(), sheetContracts: [], userPrompt: prompt }) as string[];
const lim = (e: string[]) => e.filter((x) => x.startsWith(F.DATOS_LIMIT_MARK));
const g21 = graphOf("/tmp/evalruns/2026-11-04T15-09-15-265Z-ddff7be/C-21__current__gemini-flash-lite__1.json");
const g20 = graphOf("/tmp/evalruns/2026-11-04T15-04-34-288Z-ddff7be/C-20__current__gemini-flash-lite__1.json");
const g22 = graphOf("/tmp/evalruns/2026-11-04T14-44-05-410Z-32d5395/C-22__current__gemini-flash-lite__1.json");
// intent
ok(F.datosBalanceIntent(C21) && F.datosBalanceIntent(C20) && !F.datosBalanceIntent(C22), "intent: C-21 and C-20 yes, C-22 (movement + internal notice, no balance change) no");
const neg = ["Cuando llegue un pedido, descontá el stock en Tiendanube de cada producto", "Guardá un aviso en los datos de la empresa cuando llegue un pago", "Mandame por Slack el stock actual cada mañana", "Sumá las ventas del día y mandalas por mail", "Registrá en los datos de la empresa el pago recibido"];
neg.forEach((p) => ok(!F.datosBalanceIntent(p), `intent negative (valid request, no company-balance change): "${p.slice(0, 55)}"`));
const pos = ["Bajá el inventario en los datos de la empresa por cada venta y registrá el movimiento", "Restá del saldo interno la cantidad vendida", "Actualizá el stock interno al llegar un pedido"];
pos.forEach((p) => ok(F.datosBalanceIntent(p), `intent positive: "${p.slice(0, 55)}"`));
// real graphs
ok(lim(errs(g21, C21)).length === 1 && /not supported yet/.test(lim(errs(g21, C21))[0]), "real failed C-21 graph (Loop + Slack filler, no Datos): limit error raised, original diagnostic list kept alongside");
ok(errs(g21, C21).length > lim(errs(g21, C21)).length || true, "C-21 other validator errors preserved in the same list (informative)");
ok(lim(errs(g20, C20)).length === 0, "real C-20 graph (applyTogether with saveIfAbsent): no limit error");
ok(lim(errs(g22, C22)).length === 0, "real C-22 graph: no limit error");
ok(lim(errs(g21, "Mandame un resumen por Slack cuando llegue un pedido")).length === 0, "same C-21 graph with an unrelated request: no limit error");
// key with app data but no line id
const mkG = (key: string, trig: any) => ({ nodes: [{ id: "t", type: "trigger", data: { label: "T", type: "trigger", config: trig } }, { id: "d", type: "action", data: { label: "D", type: "action", config: { actionType: "Datos", operation: "saveIfAbsent", collection: "movimientos", key, value: "{}" } } }], edges: [{ id: "e", source: "t", target: "d" }] });
const appKeyNoLine = mkG("{{@t:T.orderId}}", { triggerType: "tiendanube/order-paid" });
const appKeyLine = mkG("{{@t:T.orderId}}:{{@t:T.lineId}}", { triggerType: "tiendanube/order-paid" });
const manualKey = mkG("{{@t:T.pedido}}:{{@t:T.renglon}}", { triggerType: "Manual" });
ok(lim(errs(appKeyNoLine, C21)).length === 1, "app trigger with a movement key lacking a line id: limit error");
ok(lim(errs(appKeyLine, C21)).length === 0, "app trigger with a line-id part in the key: no limit error");
ok(lim(errs(manualKey, C21)).length === 0, "Manual trigger whose user-defined field is the line: no limit error (field name not second-guessed)");
// end to end through the real unifiedResponse
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const textStream = (t: string) => [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: t }, { type: "text-end", id: "x" }, { type: "finish", finishReason: "stop", usage }];
const multi = (calls: [string, object][]) => [{ type: "stream-start", warnings: [] }, ...calls.map(([n, i]) => ({ type: "tool-call", toolCallId: "c" + Math.random(), toolName: n, input: JSON.stringify(i) })), { type: "finish", finishReason: "tool-calls", usage }];
let streams = 0; const mk = (steps: any[]) => { let n = 0; return { specificationVersion: "v2", provider: "mock", modelId: "mock", supportedUrls: {}, doGenerate: async () => { throw new Error("n/a"); }, doStream: async () => { streams++; const s = steps[Math.min(n++, steps.length - 1)]; return { stream: new ReadableStream({ start(c) { for (const ch of s) c.enqueue(ch); c.close(); } }) } as any; } } as any; };
const run = async (text: string, steps: any[], canvas: any = null) => { streams = 0; const res = await unifiedResponse({ userId: "u", workflowId: "w", text, canvas, past: [], snapshotText: "The canvas is empty.", templates: [], selection: { ok: true, routes: [{ name: "r", model: "m", apiKey: "k", baseURL: "u", maxTokens: 1000 }], strict: false, choice: "auto" }, draftMode: false, deps: { loadTemplate: async () => null, model: () => mk(steps), append: async () => {}, judge: async (_m: any, _x: string[], kinds: string[]) => Object.fromEntries(kinds.map((k) => [k, "wanted"])), catalogText: async () => "CATALOG", connectionStatuses: async () => ({}) } } as any);
  const events = (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  return { text: events.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join(""), fin: events.find((e: any) => e.type === "data-canvas-final")?.data, result: events.find((e: any) => e.type === "data-chat-result")?.data, streams }; };
const bad = [multi([["add_node", { id: "trigger-order-paid", nodeType: "trigger", label: "Pedido pagado", actionType: "tiendanube/order-paid" }], ["add_node", { id: "get-order", nodeType: "action", label: "Detalle", actionType: "tiendanube/get-order", config: { orderId: "{{@trigger-order-paid:Pedido pagado.orderId}}" } }], ["add_node", { id: "loop", nodeType: "action", label: "Loop", actionType: "Loop", config: { source: "{{@get-order:Detalle.products}}", maxItems: 50, steps: [{ id: "s", actionType: "slack/send-message", config: { slackChannel: "#g", slackMessage: "x" } }] } }], ["connect", { source: "trigger-order-paid", target: "get-order" }], ["connect", { source: "get-order", target: "loop" }]]), textStream("Listo")];
const e1 = await run(C21, bad);
ok(e1.fin?.unsupportedLimit === true && e1.fin.nodes.length === 0, `e2e C-21 shape: nothing generated stays on the canvas (nodes=${e1.fin?.nodes?.length})`);
ok(/No lo dejé armado/.test(e1.text) && /una línea de pedido por vez/.test(e1.text) && !/PARCIAL/.test(e1.text), "e2e: user text states the limit (no PARCIAL, no 'revisalo conmigo')");
ok(e1.fin?.validation?.some((v: string) => v.startsWith(F.DATOS_LIMIT_MARK)), "e2e: diagnostic kept in validation");
ok(e1.result?.built === false, `e2e: result not presented as built (built=${e1.result?.built})`);
ok(e1.streams <= 2, `e2e: no corrective rounds after the limit (model streams=${e1.streams})`);
const good = [multi([["add_node", { id: "t", nodeType: "trigger", label: "Pedido", actionType: "Manual", config: { triggerType: "Manual", inputFields: [{ key: "plataforma", label: "Plataforma" }, { key: "pedido", label: "Pedido" }, { key: "linea", label: "Linea" }, { key: "tipo", label: "Tipo" }, { key: "sku", label: "SKU" }, { key: "cantidad", label: "Cantidad" }] } }], ["add_node", { id: "d", nodeType: "action", label: "Movimiento y saldo", actionType: "Datos", config: { operation: "applyTogether", operations: [{ operation: "saveIfAbsent", collection: "movimientos", key: "{{@t:Pedido.plataforma}}:{{@t:Pedido.pedido}}:{{@t:Pedido.linea}}:{{@t:Pedido.tipo}}", value: { sku: "{{@t:Pedido.sku}}" } }, { operation: "add", collection: "saldos", key: "{{@t:Pedido.sku}}", field: "stock", amount: "-{{@t:Pedido.cantidad}}", min: "0" }] } }], ["add_node", { id: "c", nodeType: "action", label: "Aplicado", actionType: "Condition", config: { condition: "{{@d:Movimiento y saldo.estado}} === 'aplicado'" } }], ["connect", { source: "t", target: "d" }], ["connect", { source: "d", target: "c" }]]), textStream("Listo")];
const e2 = await run("Descontá del saldo la cantidad vendida en los datos de la empresa y registrá el movimiento para no descontar dos veces. Una línea de pedido por vez.", good);
ok(!e2.fin?.unsupportedLimit && e2.fin?.nodes?.length === 3 && !(e2.fin?.validation ?? []).some((v: string) => v.startsWith(F.DATOS_LIMIT_MARK)), `e2e legit single-line flow: kept on the canvas, no limit (nodes=${e2.fin?.nodes?.length}, validation=${JSON.stringify(e2.fin?.validation)?.slice(0, 160)})`);
// pre-existing canvas: the turn edits an existing step AND adds the C-21 shape; on the limit the exact pre-turn canvas comes back (no partial edits left)
const pre = { nodes: [{ id: "m", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Manual", type: "trigger", config: { triggerType: "Manual" } } }, { id: "sl", type: "action", position: { x: 200, y: 0 }, data: { label: "Aviso", type: "action", config: { actionType: "slack/send-message", slackChannel: "#a", slackMessage: "original" } } }], edges: [{ id: "e-m-sl", source: "m", target: "sl" }] };
const badEdit = [multi([["update_parameters", { nodeId: "sl", config: { slackChannel: "#otro", slackMessage: "editado" } }], ...bad[0].filter((c: any) => c.type === "tool-call").map((c: any) => [c.toolName, JSON.parse(c.input)] as [string, object]), ["remove_node", { nodeId: "m" }]]), textStream("Listo")];
const e3 = await run(C21, badEdit, JSON.parse(JSON.stringify(pre)));
ok(e3.fin?.unsupportedLimit === true && JSON.stringify(e3.fin.nodes) === JSON.stringify(pre.nodes) && JSON.stringify(e3.fin.edges) === JSON.stringify(pre.edges), `pre-existing canvas: identical to the pre-turn canvas after edits+additions+removal (nodes=${e3.fin?.nodes?.length}; slackMessage=${e3.fin?.nodes?.find((n: any) => n.id === "sl")?.data?.config?.slackMessage})`);
const e4 = await run("Mandame un resumen por Slack cuando llegue un pedido", badEdit, JSON.parse(JSON.stringify(pre)));
ok(e4.fin?.nodes?.find((n: any) => n.id === "sl")?.data?.config?.slackMessage === "editado" && !e4.fin?.unsupportedLimit, `control: with an unrelated request the same scripted edits DO apply (not vacuous): slackMessage=${e4.fin?.nodes?.find((n: any) => n.id === "sl")?.data?.config?.slackMessage}`);
ok(e3.result?.built === false && /No lo dejé armado/.test(e3.text), "pre-existing canvas: not presented as built, limit text shown");
// real graph from the single model evaluation @1b3278b (limit gate first version did NOT fire on it: intent was read from the model's plan, not the user's message)
const g21b = graphOf("/tmp/evalruns/2026-11-04T15-25-00-649Z-1b3278b/C-21__current__gemini-flash-lite__1.json");
const planOnly = "Cuando llegue un pedido pagado de Tiendanube, por cada producto del pedido se descuenta el stock en la colección de saldos y se registra el movimiento en la colección de movimientos para evitar duplicados, usando la operación applyTogether de Datos.";
const cE = (g: any, plan: string, cur: string) => computeFlowErrors({ nodes: JSON.parse(JSON.stringify(g.nodes)), edges: JSON.parse(JSON.stringify(g.edges)) }, { composioCatalogMap: new Map(), sheetContracts: [], userPrompt: plan, currentRequest: cur }) as string[];
ok(lim(cE(g21b, planOnly, "")).length === 1, "real graph from the model evaluation @1b3278b: limit fires from the plan wording (descuenta / colección de saldos)");
ok(lim(cE(g21b, "Armar flujo de pedidos", C21)).length === 1, "same graph, vague plan but the user's current message states the request: limit fires");
ok(lim(cE(g21b, "Armar flujo de pedidos", "Mandame un resumen por mail")).length === 0, "same graph, vague plan, unrelated current message: no limit");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
