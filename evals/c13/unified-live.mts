// Live single-turn probe of the unified agent with the REAL model route (free Gemini key, native provider) and the REAL catalog.
// Usage: GEMINI_API_KEY=... npx tsx evals/c13/unified-live.mts "<user message>" [prior.json]
import Module from "node:module"; import { createRequire } from "node:module"; import fs from "node:fs";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; process.env.BETTER_AUTH_SECRET ??= "x".repeat(32); process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
const { unifiedResponse } = await import("../../app/api/workflow-chat/unified");
const { selectRoutes } = await import("../../lib/model-select");
process.env.QA_AI_USER_IDS = "*";
const sel = selectRoutes("g", "u"); if (!sel.ok) { console.log("SEL", sel); process.exit(1); }
const past = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : [];
const res = await unifiedResponse({ userId: "u", workflowId: "w", text: process.argv[2], canvas: null, past, snapshotText: "The canvas is empty.", templates: [], selection: sel, draftMode: false,
  deps: { append: async () => {}, connectOutcome: async (_u: string, a: string) => ({ kind: "manual", name: a, fields: ["credentials"] }) as any } });
const body = await res.text(); const ev = body.split("\n").filter(l => l.startsWith("data: ")).map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
console.log("TEXT:", ev.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join(""));
console.log("RESULT:", JSON.stringify(ev.find((e: any) => e.type === "data-chat-result")?.data));
{ const b = ev.find((e: any) => e.type === "data-chat-result")?.data?.build; if (b) fs.writeFileSync("/tmp/plan.txt", b); }
console.log("ERR:", ev.find((e: any) => e.type === "data-chat-error")?.data?.error ?? "-");
console.log("TRACE:", JSON.stringify(ev.find((e: any) => e.type === "data-model-trace")?.data ?? "-"));
