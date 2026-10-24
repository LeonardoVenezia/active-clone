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
const stubPath = require_.resolve("../semantic/stubs/server-only.ts");
const origResolve = (Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string })._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return stubPath;
  return origResolve.call(this, request, ...rest);
};

const here = path.dirname(fileURLToPath(import.meta.url));

// C-13 builder runner. Usage:
//  npx tsx evals/c13/run.mts --scenario S1|S2 --arm A|B --model gemini-3.5-flash-lite --out /tmp/c13.json
// Arm A = prompt exactly as chat-panel.tsx builds it today. Arm B = A + experimental information addendum
// (action descriptions from the registry + connection assumptions + generic ask rule). Nothing is deployed.
const arg = (k: string) => { const a = process.argv.slice(2); const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
const scenario = arg("scenario") ?? "S1"; const armName = arg("arm") ?? "A"; const modelPin = arg("model");
const outPath = arg("out") ?? `/tmp/c13-${scenario}-${armName}-${Date.now()}.json`;
if (!modelPin) { console.error("need --model"); process.exit(2); }
const here2 = path.dirname(fileURLToPath(import.meta.url));
const C = JSON.parse(fs.readFileSync(path.join(here2, "case.json"), "utf8"));
const { auth } = await import("../../lib/auth");
try { (auth.api as Record<string, unknown>).getSession = async () => ({ user: { id: "eval-c13", isAnonymous: false }, session: { id: "eval-c13-s" } }); }
catch { Object.defineProperty(auth.api, "getSession", { value: async () => ({ user: { id: "eval-c13", isAnonymous: false }, session: { id: "eval-c13-s" } }) }); }
await import("../../plugins");
const { getAllIntegrations } = await import("../../plugins/registry");
const { POST } = await import("../../app/api/ai/generate/route");

type Msg = { role: string; content: string };
const convo: Msg[] = [{ role: "user", content: C.userRequest }, { role: "assistant", content: C.assistantTurn1 }, { role: "user", content: C.userTurn2 }, { role: "assistant", content: C.assistantTurn2 }];
let instruction: string = C.reconstructedBuildInstruction;
if (scenario === "S2") {
  convo.push({ role: "user", content: "El producto es el Termo Stanley 1L verde, buscalo por ese nombre en las dos tiendas." });
  instruction += ". Producto: Termo Stanley 1L verde, buscarlo por ese nombre en Tiendanube y Mercado Libre";
}
const catalogInstruction = "\n\nNo Composio action catalog has been loaded. Do not create a Composio action or invent a toolkit.";
let prompt = `Conversation so far:\n${convo.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n")}\n\nWhat to do on the canvas now: ${instruction}\n\nApps with a native plugin (whatsapp, slack, tiendanube, mercadolibre, zipnova, stripe, github, linear, mercadopago) MUST use the plugin action (e.g. whatsapp/send-message, slack/send-message): never generic "Send Message"/"Send Email", never hand-rolled HTTP Request, never the Composio toolkit for those apps. For another app, use Run Composio Action only with the exact toolkit/slug pair from the real catalog below. Set arguments as a JSON string matching that action's input schema. Wire every value an earlier step produces with a template ({{@node-id:Step Label.field.path}}); never ask the user for data that earlier steps produce. If there is no matching listed action, do not guess; ask or explain what is missing.${catalogInstruction}`;
// NOTE: the COMPOSIO catalogInstruction text above is a paraphrase of the empty-catalog branch (line 54 of chat-panel.tsx); verify before quoting.
const actions: { id: string; label: string; desc: string; video: boolean }[] = [];
for (const p of getAllIntegrations()) for (const a of p.actions) actions.push({ id: `${p.type}/${a.slug}`, label: a.label, desc: String(a.description ?? ""), video: (a as { outputConfig?: { type?: string } }).outputConfig?.type === "video" });
if (armName === "R") { prompt = `Conversation so far:\n${convo.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n")}\n\nWhat to do on the canvas now: ${instruction}`; }
if (armName === "B") {
  prompt += `\n\nACTION DESCRIPTIONS (what each listed action really does):\n${actions.map(a => `- ${a.id}: ${a.desc}`).join("\n")}\n\nASSUMPTION: no app connections are configured yet; name any connection the plan needs in your closing message. If a value the flow needs (what the flow is about, an id, a text) appears neither in the conversation nor as the output of an earlier step, ask for it with ask_user before building instead of filling it with a generic word.`;
}
const req = new Request("http://eval.local/api/ai/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, model: modelPin, builder: "tools" }) });
const t0 = Date.now(); const res = await POST(req); const text = await res.text();
const nodes: any[] = [], edges: any[] = []; const msgs: any[] = [];
for (const line of text.split("\n")) { const t = line.trim(); if (!t) continue; try { const m = JSON.parse(t);
  if (m.type === "operation") { const o = m.operation; if (o.op === "addNode" && o.node) nodes.push(o.node); else if (o.op === "addEdge" && o.edge) edges.push(o.edge);
    else if (o.op === "removeNode") { const i = nodes.findIndex(n => n.id === o.nodeId); if (i >= 0) nodes.splice(i, 1); }
    else if (o.op === "updateNode") { const n = nodes.find(x => x.id === o.nodeId); if (n) n.data = { ...n.data, ...(o.updates?.data ?? {}), config: { ...(n.data?.config ?? {}), ...(o.updates?.data?.config ?? {}) } }; } }
  else msgs.push(m); } catch { msgs.push({ unparsed: t.slice(0, 200) }); } }
// --- scoring (registry-driven, no word rules)
const convoText = convo.map(m => m.content).join("\n").toLowerCase();
const videoIds = new Set(actions.filter(a => a.video).map(a => a.id));
const flat = (v: any, out: [string, string][] = [], k = ""): [string, string][] => { if (typeof v === "string") out.push([k, v]); else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) flat(vv, out, kk); return out; };
const invented: string[] = []; const idUnwired: string[] = [];
for (const n of nodes) { const cfg = n.data?.config ?? {}; const at = String(cfg.actionType ?? ""); if (!at.includes("/")) continue;
  for (const [k, v] of flat(cfg)) { if (["actionType", "prompt", "text", "message", "systemPrompt"].includes(k)) continue; if (v.includes("{{")) continue; if (v.length === 0 || v.length > 60) continue;
    const toks = v.toLowerCase().split(/\s+/).filter(Boolean); const known = toks.every(t => convoText.includes(t)); if (!known) invented.push(`${n.id}.${k}="${v}"`);
    if (/(^|[a-z])id$/i.test(k) && /get-/.test(at)) idUnwired.push(`${n.id}.${k}="${v}"`); } }
const videoNodes = nodes.filter(n => videoIds.has(String(n.data?.config?.actionType ?? "")) || JSON.stringify(n.data?.config?.steps ?? []).match([...videoIds].map(s => s.replace(/[/.]/g, "\\$&")).join("|") || "$^"));
const q = msgs.find(m => m.type === "question"); const summary = msgs.filter(m => m.type === "summary").map(m => m.text).join(" ");
const claimsDone = /\b(listo|armé|arme|quedó|quedo|ya está|ya esta)\b/i.test(summary);
const verdict = {
  scenario, arm: armName, model: modelPin, ms: Date.now() - t0, nodes: nodes.length, edges: edges.length,
  asked_question: q?.text ?? null, summary,
  inputs_resolved: invented.length === 0, invented_literals: invented,
  detail_ids_wired: idUnwired.length === 0, id_unwired: idUnwired,
  requested_result_kept: videoNodes.length > 0 || /video/i.test(summary + (q?.text ?? "")) && !claimsDone,
  video_nodes: videoNodes.map(n => n.id),
  no_false_done: !(claimsDone && videoNodes.length === 0),
  actions_used: nodes.map(n => n.data?.config?.actionType ?? n.data?.config?.triggerType),
  other_messages: msgs.filter(m => !["question", "summary"].includes(m.type)).slice(0, 5),
};
fs.writeFileSync(outPath, JSON.stringify({ verdict, nodes, edges }, null, 2));
console.log(JSON.stringify(verdict, null, 2));
