// Offline, no model/network: assembled builder prompt (tools mode) size + coherence checks.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
await import("../../plugins");
const B: any = await import("../../lib/agent/build-core"); const g = (B.default ?? B).getSystemPrompt;
const p: string = g("", "tools");
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
console.log("tools-mode prompt chars:", p.length);
t("no JSONL position rules in tools mode", !/NODE POSITIONING RULES/.test(p));
t("no 'position' node JSON in tools mode", !/"position": \{"x"/.test(p));
t("no edge JSON structure in tools mode", !/"source": "source-node-id"/.test(p));
t("example uses real aiPrompt key", !/"config":\{"prompt":/.test(p) && /"aiPrompt":/.test(p));
t("no MUST-parallel-branches vs one-line contradiction", !/MUST be parallel branches/.test(p));
const pn: string = g("", "tools", { canAsk: false });
t("no ask_user instruction when ask tool is removed", !/ask_user/.test(pn));
t("ask_user kept when tool exists", /ask_user/.test(p));
for (const [n, ok] of res) console.log(ok ? "PASS" : "FAIL", n);
process.exit(res.every(([, ok]) => ok) ? 0 : 1);
