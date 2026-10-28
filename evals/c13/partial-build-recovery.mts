// Offline: what a partial build leaves for the user. (1) a step left without an incoming edge whose references point to one finished
// chain is wired after it (exact repair; ambiguous cases stay flagged); (2) a literal that is not a date in a field whose declared
// example is an ISO date is flagged; (3) the PARCIAL status is followed by a plain-language list of what is pending and how to go on,
// even when every later model call fails. Scripted model through the REAL unifiedResponse: no network, no spend. Minimal synthetic graphs.
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync, readdirSync } from "node:fs";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; process.env.BETTER_AUTH_SECRET ??= "x".repeat(32); process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
await import("../../plugins");
const B: any = await import("../../lib/agent/build-core"); const { computeFlowErrors } = B.default ?? B;
const { unifiedResponse } = await import("../../app/api/workflow-chat/unified");
const res: [string, boolean, string][] = []; const t = (n: string, ok: boolean, d = "") => res.push([n, ok, d]);
const n = (id: string, label: string, config: any, type = "action") => ({ id, type, data: { label, type, config } });
const E = (pairs: string[][]) => pairs.map(([source, target]) => ({ id: `e-${source}-${target}`, source, target }));
const errsOf = (g: { nodes: any[]; edges: any[] }) => computeFlowErrors(g, { composioCatalogMap: new Map(), sheetContracts: [], userPrompt: "" }) as string[];
const has = (g: { edges: any[] }, s: string, d: string) => g.edges.some((e) => e.source === s && e.target === d);
const trig = n("cron", "Cada mañana", { triggerType: "Schedule", scheduleCron: "0 9 * * *" }, "trigger");
const search = (cfg: any = {}) => n("pedidos", "Buscar pedidos", { actionType: "tiendanube/search-orders", createdAtMin: "2026-10-27T00:00:00-03:00", ...cfg });
const ai = n("resumen", "Resumen IA", { actionType: "ai-gateway/generate-text", aiFormat: "text", aiPrompt: "Cantidad de pedidos: {{@pedidos:Buscar pedidos.count}}" });
const slack = (msg = "{{@resumen:Resumen IA.text}}") => n("slack", "Enviar a Slack", { actionType: "slack/send-message", slackChannel: "#ventas", slackMessage: msg });

// (1) wiring repair
{ const g = { nodes: [trig, search(), ai, slack()], edges: E([["cron", "pedidos"], ["pedidos", "resumen"]]) }; const e = errsOf(g);
  t("dangling step referencing the end of the chain: wired after it, no 'not connected' error left", has(g, "resumen", "slack") && !e.some((x) => /not connected from the trigger/.test(x)), JSON.stringify(e)); }
{ const g = { nodes: [trig, search(), ai, slack("{{@pedidos:Buscar pedidos.count}}")], edges: E([["cron", "pedidos"], ["pedidos", "resumen"]]) }; errsOf(g);
  t("referenced step already has an outgoing edge: not wired (stays flagged)", !g.edges.some((x) => x.target === "slack")); }
{ const other = n("otro", "Otro resumen", { actionType: "ai-gateway/generate-text", aiFormat: "text", aiPrompt: "x {{@pedidos:Buscar pedidos.count}}" });
  const g = { nodes: [trig, search(), ai, other, slack("{{@resumen:Resumen IA.text}} {{@otro:Otro resumen.text}}")], edges: E([["cron", "pedidos"], ["pedidos", "resumen"], ["pedidos", "otro"]]) }; errsOf(g);
  t("references to two parallel branches (needs a join): not wired", !g.edges.some((x) => x.target === "slack")); }
{ const g = { nodes: [trig, search(), ai, slack()], edges: E([["pedidos", "resumen"]]) }; errsOf(g);
  t("referenced step not reachable from the trigger: not wired", !g.edges.some((x) => x.target === "slack")); }
{ const g = { nodes: [trig, search(), slack("Hola")], edges: E([["cron", "pedidos"]]) }; const e = errsOf(g);
  t("dangling step with no references: not wired, still flagged", !g.edges.some((x) => x.target === "slack") && e.some((x) => /"slack".*not connected from the trigger/.test(x)), JSON.stringify(e)); }
{ const g = { nodes: [trig, search(), ai, slack()], edges: E([["cron", "pedidos"], ["slack", "resumen"]]) }; errsOf(g);
  t("referenced step is downstream of the dangling step (would loop): not wired", !has(g, "resumen", "slack")); }

// (2) literal dates
const dateErr = (cfg: any) => errsOf({ nodes: [trig, search(cfg)], edges: E([["cron", "pedidos"]]) }).filter((x) => /which is not a date/.test(x));
t("createdAtMin 'NOW-1DAY': flagged with the field's example", (() => { const e = dateErr({ createdAtMin: "NOW-1DAY" }); return e.length === 1 && e[0].includes("NOW-1DAY") && e[0].includes("2026-10-01T00:00:00-03:00"); })(), JSON.stringify(dateErr({ createdAtMin: "NOW-1DAY" })));
t("createdAtMin non-padded '2026-3-4T00:00:00-03:00': flagged", dateErr({ createdAtMin: "2026-3-4T00:00:00-03:00" }).length === 1);
t("createdAtMin ISO literal: not flagged", dateErr({ createdAtMin: "2026-10-27T00:00:00-03:00" }).length === 0);
t("createdAtMin plain ISO date: not flagged", dateErr({ createdAtMin: "2026-10-27" }).length === 0);
t("createdAtMin from a template: not judged", dateErr({ createdAtMin: "{{@f:F.result}}" }).length === 0);
t("field without an ISO-date example (limit 'veinte'): not judged by this check", dateErr({ limit: "veinte" }).length === 0);
{ const mail = (at: string) => errsOf({ nodes: [trig, n("mail", "Mandar mail", { actionType: "resend/send-email", emailTo: "a@b.co", emailSubject: "x", emailBody: "x", emailScheduledAt: at })], edges: E([["cron", "mail"]]) }).filter((x) => /which is not a date/.test(x));
  t("resend emailScheduledAt 'in 1 hour' (Resend accepts relative dates): not flagged", mail("in 1 hour").length === 0, JSON.stringify(mail("in 1 hour")));
  t("resend emailScheduledAt ISO: not flagged", mail("2026-10-28T09:00:00-03:00").length === 0);
  t("Tiendanube createdAtMin 'NOW-1DAY' still flagged (exemption is per field)", dateErr({ createdAtMin: "NOW-1DAY" }).length === 1); }
{ const loop = n("loop", "Cada pedido", { actionType: "Loop", source: "{{@pedidos:Buscar pedidos.orders}}", steps: [{ id: "buscar", actionType: "tiendanube/search-orders", config: { createdAtMin: "ayer" } }] });
  const e = errsOf({ nodes: [trig, search(), loop], edges: E([["cron", "pedidos"], ["pedidos", "loop"]]) }).filter((x) => /which is not a date/.test(x));
  t("literal non-date inside a Loop inner step: flagged", e.length === 1 && e[0].includes("Cada pedido > buscar"), JSON.stringify(e)); }

// (3) end to end: turn-2 edit cut midway (step re-created, not reconnected), corrective and guide calls fail.
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const mk = (steps: (object[] | Error)[]) => { let i = 0; return { specificationVersion: "v2", provider: "mock", modelId: "mock", supportedUrls: {}, doGenerate: async () => { throw new Error("n/a"); }, doStream: async () => { const s = steps[Math.min(i++, steps.length - 1)]; if (s instanceof Error) throw s; return { stream: new ReadableStream({ start(c) { for (const ch of s) c.enqueue(ch); c.close(); } }) }; } }; };
const call = (name: string, input: object) => ({ type: "tool-call", toolCallId: `c${Math.random()}`, toolName: name, input: JSON.stringify(input) });
const formula = n("total", "Calcular total", { actionType: "Fórmula", input: "{{@pedidos:Buscar pedidos.orders}}", expression: "$sum(total)" });
const canvas = { nodes: [trig, search({ createdAtMin: "NOW-1DAY" }), formula, n("slack", "Enviar a Slack", { actionType: "slack/send-message", slackChannel: "#general", slackMessage: "Total: {{@total:Calcular total.result}}" })], edges: E([["cron", "pedidos"], ["pedidos", "total"], ["total", "slack"]]) };
const cut = [{ type: "stream-start", warnings: [] },
  call("add_node", { id: "resumen", nodeType: "action", label: "Resumen IA", actionType: "ai-gateway/generate-text", config: { aiFormat: "text", aiPrompt: "Total {{@total:Calcular total.result}}, pedidos {{@pedidos:Buscar pedidos.count}}" } }),
  call("connect", { source: "total", target: "resumen" }), call("remove_node", { nodeId: "slack" }),
  call("add_node", { id: "slack", nodeType: "action", label: "Enviar a Slack", actionType: "slack/send-message", config: { slackChannel: "#ventas", slackMessage: "{{@resumen:Resumen IA.text}}" } }),
  { type: "error", error: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) }];
const model = mk([cut, Object.assign(new Error("upstream 520"), { statusCode: 520 }), Object.assign(new Error("upstream 520"), { statusCode: 520 })]);
const out = await unifiedResponse({ userId: "u", workflowId: "w", text: "El canal es #ventas. Además del total quiero la cantidad de pedidos. Corregilo.", canvas, past: [], snapshotText: "", templates: [], selection: { ok: true, routes: [{ name: "r", model: "m", apiKey: "k", baseURL: "u", maxTokens: 1000 }], strict: false, choice: "auto" }, draftMode: false,
  deps: { model: () => model, append: async () => {}, judge: async () => ({}), catalogText: async () => "CATALOG", connectionStatuses: async () => ({}), loadTemplate: async () => null } } as any);
const events = (await out.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
const text = events.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join(""); const fin = events.find((e: any) => e.type === "data-canvas-final")?.data;
t("interrupted edit: final canvas has the re-created Slack step wired after the new AI step", fin?.interrupted === true && has(fin, "resumen", "slack"), JSON.stringify(fin?.edges));
t("interrupted edit: the remaining point (literal date) is still reported", fin?.validation?.some((v: string) => /which is not a date/.test(v)), JSON.stringify(fin?.validation));
t("user text: PARCIAL, then what is pending by step label in plain words, then how to continue", /^Estado del armado: PARCIAL \(se cortó una llamada al modelo\)/.test(text) && /Qué falta:\n- «Buscar pedidos»: tiene una fecha que no es válida\./.test(text) && /Para seguir: /.test(text) && !/createdAtMin|NOW-1DAY|configuración/.test(text), JSON.stringify(text));

// Measured on the 154 semantic snapshots (informative baseline; a change here needs a manual look).
const dir = "evals/semantic/snapshots/"; const wiredIn: string[] = []; const dateIn: string[] = [];
for (const f of readdirSync(dir)) { const g = JSON.parse(readFileSync(dir + f, "utf8")); g.edges ??= []; const before = g.edges.length; const e = errsOf(g); if (g.edges.length !== before) wiredIn.push(f); if (e.some((x) => /which is not a date/.test(x))) dateIn.push(f); }
t("snapshots: wiring repair fires only on t-c02-3 (trigger with no edges, get-order referencing it)", wiredIn.join() === "t-c02-3.json", wiredIn.join());
t("snapshots: literal-date check fires only on the 'NOW-1DAY' graph", dateIn.join() === "fulljson-brsbpx2c2f5mvn6m8o572.json", dateIn.join());

let fails = 0; for (const [k, ok, d] of res) { console.log(ok ? "PASS" : "FAIL", k, ok ? "" : d); if (!ok) fails++; } console.log(`${res.length - fails}/${res.length}`); process.exit(fails ? 1 : 0);
