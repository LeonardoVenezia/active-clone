/**
 * A/B live runner: executes the REAL /api/ai/generate route in-process (same
 * system prompt, validator, corrective pipeline, model pinning) against a
 * pinned model, and writes a snapshot {name,nodes,edges} for check.mjs.
 *
 * Usage:
 *   npx tsx evals/semantic/live-ab.mts --case C-09 --model deepseek-v4.1-flash-fast --out /tmp/snap.json
 * Env: provider keys as used by lib/free-models.ts (GEMINI_API_KEY, REFUSELESS_API_KEY, ...),
 * COMPOSIO_API_KEY for the live catalog, plus dummy BETTER_AUTH_* / DATABASE_URL (session is stubbed).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Module from "node:module";
import { createRequire } from "node:module";

// Stub the "server-only" guard package (throws outside RSC bundlers).
const require_ = createRequire(import.meta.url);
const stubPath = require_.resolve("./stubs/server-only.ts");
const origResolve = (Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string })._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return stubPath;
  return origResolve.call(this, request, ...rest);
};

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const caseId = arg("case");
const modelPin = arg("model");
const builder = arg("builder");
const outPath = arg("out") ?? `/tmp/ab-${caseId}-${modelPin}-${Date.now()}.json`;
if (!caseId || !modelPin) { console.error("need --case and --model"); process.exit(2); }

const cases = fs.readFileSync(path.join(here, "..", "cases.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const c = cases.find((x: { id: string }) => x.id === caseId);
if (!c) { console.error("case not found", caseId); process.exit(2); }
const prompt: string = c.prompt;

// Stub the session before the route module is used.
const { auth } = await import("../../lib/auth");
try {
  (auth.api as Record<string, unknown>).getSession = async () => ({ user: { id: "eval-ab-user", isAnonymous: false }, session: { id: "eval-ab-session" } });
} catch {
  Object.defineProperty(auth.api, "getSession", { value: async () => ({ user: { id: "eval-ab-user", isAnonymous: false }, session: { id: "eval-ab-session" } }) });
}

const { POST } = await import("../../app/api/ai/generate/route");

type Op = { op: string; name?: string; description?: string; node?: Record<string, unknown>; edge?: Record<string, unknown>; nodeId?: string; edgeId?: string; updates?: { position?: unknown; data?: Record<string, unknown> } };

function applyOp(nodes: Record<string, unknown>[], edges: Record<string, unknown>[], o: Op) {
  if (o.op === "addNode" && o.node) nodes.push(o.node);
  else if (o.op === "addEdge" && o.edge) { const e = o.edge as { id?: string; source?: string; target?: string }; if (!e.id) e.id = `e-${e.source}-${e.target}`; edges.push(o.edge); }
  else if (o.op === "removeNode" && o.nodeId) { const i = nodes.findIndex(n => n.id === o.nodeId); if (i >= 0) nodes.splice(i, 1); for (let i = edges.length - 1; i >= 0; i--) { const e = edges[i] as { source?: string; target?: string }; if (e.source === o.nodeId || e.target === o.nodeId) edges.splice(i, 1); } }
  else if (o.op === "removeEdge" && o.edgeId) { const i = edges.findIndex(e => (e as { id?: string }).id === o.edgeId); if (i >= 0) edges.splice(i, 1); }
  else if (o.op === "updateNode" && o.nodeId && o.updates) {
    const n = nodes.find(x => x.id === o.nodeId) as { data?: Record<string, unknown>; position?: unknown } | undefined;
    if (n) {
      const upd = o.updates.data;
      if (upd) { const nc = (n.data?.config ?? {}) as Record<string, unknown>; const uc = (upd.config ?? {}) as Record<string, unknown>; n.data = { ...(n.data ?? {}), ...upd, config: { ...nc, ...uc } }; }
      if (o.updates.position) n.position = o.updates.position;
    }
  }
}

const req = new Request("http://eval.local/api/ai/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt, model: modelPin, ...(builder ? { builder } : {}) }),
});
const t0 = Date.now();
const res = await POST(req);
const nodes: Record<string, unknown>[] = [];
const edges: Record<string, unknown>[] = [];
let name = "";
let opCount = 0;
const other: string[] = [];
const text = await res.text();
for (const line of text.split("\n")) {
  const t = line.trim(); if (!t) continue;
  try {
    const msg = JSON.parse(t);
    if (msg.type === "operation") { const o = msg.operation as Op; if (o.op === "setName" && o.name) name = o.name; applyOp(nodes, edges, o); opCount++; }
    else other.push(JSON.stringify(msg).slice(0, 300));
  } catch { other.push(`UNPARSED: ${t.slice(0, 200)}`); }
}
const snap = { name: name || `ab-${caseId}-${modelPin}`, nodes, edges };
fs.writeFileSync(outPath, JSON.stringify(snap, null, 2));
console.log(JSON.stringify({ out: outPath, ms: Date.now() - t0, opCount, nodes: nodes.length, edges: edges.length, name: snap.name, messages: other.slice(0, 8) }, null, 2));
