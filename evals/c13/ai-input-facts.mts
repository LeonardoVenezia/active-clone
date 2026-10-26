// Offline, no model/network: assembled builder prompt (tools mode) size + coherence checks.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
await import("../../plugins");
// Offline: aiInputFacts must list exactly the fields an AI step can read (from the declared output contract), following Formula steps. Plumbing check only, no model.
const B: any = await import("../../lib/agent/build-core"); const { aiInputFacts, lineageFacts } = B.default ?? B;
const node = (id: string, label: string, config: any, type = "action") => ({ id, data: { label, type, config } });
// Same shape as the saved graph from the ventas regression case (workflow hmm1f550...), config trimmed.
const ventas = { nodes: [
  node("t", "Cada mañana", { triggerType: "Schedule" }, "trigger"),
  node("pedidos", "Buscar pedidos", { actionType: "tiendanube/search-orders" }),
  node("solo", "Pedidos de ayer", { actionType: "Fórmula", input: "{\"ordenes\": {{@pedidos:Buscar pedidos.orders}}}", expression: "ordenes" }),
  node("resumen", "Armar resumen", { actionType: "ai-gateway/generate-text", aiPrompt: "Resumen. Pedidos: {{@solo:Pedidos de ayer}}. Incluir los productos más vendidos." }),
], edges: [] };
const f: string[] = aiInputFacts(ventas); console.log(f.join("\n"));
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
t("one fact for the AI step", f.length === 1);
t("lists the order summary fields", /Buscar pedidos\.orders \(each record has only: id, number, status, paymentStatus, shippingStatus, total, currency, customerEmail, customerName, createdAt\)/.test(f[0] ?? ""));
t("does not list products", !/products/.test(f[0] ?? ""));
t("included in lineageFacts", lineageFacts(ventas).some((x: string) => x.startsWith("AI step")));
const none = { nodes: [node("a", "Resumen", { actionType: "ai-gateway/generate-text", aiPrompt: "Escribí un saludo" })], edges: [] };
t("no fact when the prompt reads no upstream data", aiInputFacts(none).length === 0);
for (const [n, ok] of res) console.log(ok ? "PASS" : "FAIL", n); process.exit(res.every(r => r[1]) ? 0 : 1);
