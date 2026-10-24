// Tool-edge validation with the REAL AI SDK (scripted model, no network/spend). Proves plumbing + atomicity, not model quality.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; process.env.BETTER_AUTH_SECRET ??= "x".repeat(32); process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
await import("../../plugins");
const { streamText, stepCountIs } = await import("ai");
const { createBuildTools } = await import("../../lib/agent/build-core");
let fails = 0; const ck = (n: string, c: boolean) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fails++; };
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const call = (name: string, input: object) => ({ type: "tool-call", toolCallId: "c" + Math.random(), toolName: name, input: JSON.stringify(input) });
const mk = (steps: object[][]) => { let n = 0; return ({ specificationVersion: "v2", provider: "mock", modelId: "m", supportedUrls: {}, doGenerate: async () => { throw new Error("n/a"); }, doStream: async () => { const s = steps[Math.min(n++, steps.length - 1)]; return { stream: new ReadableStream({ start(c) { for (const ch of s) c.enqueue(ch); c.close(); } }) } as any; } }) as any; };
const fin = (reason: string) => ({ type: "finish", finishReason: reason, usage });
const tc = (calls: object[]) => [{ type: "stream-start", warnings: [] }, ...calls, fin("tool-calls")];
const txt = [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: "ok" }, { type: "text-end", id: "x" }, fin("stop")];
async function drive(steps: object[][], shadow: any) {
  const rejects: any[] = []; const results: any[] = []; const tools: any = createBuildTools(shadow, { noAsk: true, onReject: m => rejects.push(m) });
  const res = streamText({ model: mk(steps), messages: [{ role: "user", content: "x" }], tools, stopWhen: stepCountIs(6), maxRetries: 0 });
  for await (const p of res.fullStream as any) { if (p.type === "tool-result") results.push(p.output); if (p.type === "error") results.push({ sdkError: String((p.error as any)?.message ?? p.error).slice(0, 80) }); }
  return { rejects, results };
}
const mkShadow = () => ({ name: "", description: "", nodes: [{ id: "t1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Inicio", type: "trigger", config: { triggerType: "Manual", note: "keep", inputFields: [{ key: "a", label: "A" }] } } }], edges: [] }) as any;
const snap = (s: any) => JSON.stringify(s);
const SECRET = "sk-SECRET-VALUE-123", LABEL = "Etiqueta privada XYZ";
// (a) {item:[...]} rejected, atomic, SDK continues
{ const sh = mkShadow(); const before = snap(sh);
  const { rejects, results } = await drive([tc([call("update_parameters", { nodeId: "t1", config: { inputFields: { item: [{ key: "p", label: LABEL, token: SECRET }] }, note: "changed" } })]), txt], sh);
  ck("a: object-shaped inputFields -> ok:false", results[0]?.ok === false);
  ck("a: graph unchanged (atomic, incl. unrelated field in same patch)", snap(sh) === before);
  ck("a: SDK stream continued to stop (no Invalid prompt)", !results.some(x => x?.sdkError));
  ck("a: metadata allowlist only", rejects.length === 1 && JSON.stringify(rejects[0]) === JSON.stringify({ tool: "update_parameters", field: "inputFields", received: "object", structuralKeys: ["item"], result: "rejected" }));
  const dump = JSON.stringify(rejects);
  ck("d: no secret/label/value in metadata", !dump.includes(SECRET) && !dump.includes(LABEL) && !dump.includes("\"p\""));
  // (c) model retries with array
  const sh2 = mkShadow();
  const r2 = await drive([tc([call("update_parameters", { nodeId: "t1", config: { inputFields: { item: [{ key: "p", label: "P" }] } } })]), tc([call("update_parameters", { nodeId: "t1", config: { inputFields: [{ key: "p", label: "P" }] } })]), txt], sh2);
  ck("c: retry with array applies", r2.results[0]?.ok === false && r2.results[1]?.ok === true && sh2.nodes[0].data.config.inputFields[0].key === "p" && sh2.nodes[0].data.config.note === "keep");
}
// (b) valid array applies; unrelated patch never blocked even when existing inputFields invalid
{ const sh = mkShadow(); const r1 = await drive([tc([call("update_parameters", { nodeId: "t1", config: { inputFields: [{ key: "x", label: "X", required: true }] } })]), txt], sh);
  ck("b: valid array applies", r1.results[0]?.ok === true && sh.nodes[0].data.config.inputFields[0].key === "x");
  const sh3 = mkShadow(); sh3.nodes[0].data.config.inputFields = { item: [] };
  const r3 = await drive([tc([call("update_parameters", { nodeId: "t1", config: { note: "draft edit" } })]), txt], sh3);
  ck("b: patch not touching inputFields is not blocked", r3.results[0]?.ok === true && sh3.nodes[0].data.config.note === "draft edit");
  const sh4 = mkShadow(); const r4 = await drive([tc([call("update_parameters", { nodeId: "t1", config: { inputFields: [{ key: "ok", label: "ok" }, { key: "ok", label: "dup" }] } })]), txt], sh4);
  ck("b: candidate-state problem (duplicate key) rejected, graph kept", r4.results[0]?.ok === false && sh4.nodes[0].data.config.inputFields[0].key === "a" && r4.rejects[0].received === "array");
}
// add_node
{ const sh = mkShadow(); const r1 = await drive([tc([call("add_node", { id: "t2", nodeType: "trigger", label: "M", actionType: "Manual", config: { inputFields: "producto" } })]), txt], sh);
  ck("add_node: invalid inputFields rejected, no node added", r1.results[0]?.ok === false && sh.nodes.length === 1 && r1.rejects[0].tool === "add_node" && r1.rejects[0].received === "string");
  const sh2 = mkShadow(); const r2 = await drive([tc([call("add_node", { id: "t2", nodeType: "trigger", label: "M", actionType: "Manual", config: { inputFields: [{ key: "q", label: "Q" }] } })]), txt], sh2);
  ck("add_node: valid applies", r2.results[0]?.ok === true && sh2.nodes.length === 2); }
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS"); process.exit(fails ? 1 : 0);
