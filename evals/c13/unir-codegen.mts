// @ts-nocheck
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (/^server-only$/.test(q)) return r.resolve("../../evals/semantic/stubs/server-only.ts"); return o.call(this, q, ...a); };
const a: any = await import("../../lib/workflow-codegen"); const b: any = await import("../../lib/workflow-codegen-sdk");
const n = (id: string, cfg: any, type = "action") => ({ id, type, position: { x: 0, y: 0 }, data: { type, label: id, config: cfg, status: "idle" } });
const nodes = [n("t", { triggerType: "Manual" }, "trigger"), n("a", { actionType: "Delay", durationSeconds: 1 }), n("b", { actionType: "Delay", durationSeconds: 1 }), n("u", { actionType: "Unir" })];
const edges = [["t", "a"], ["t", "b"], ["a", "u"], ["b", "u"]].map(([s, t]) => ({ id: s + t, source: s, target: t }));
let f = 0; const ok = (c: boolean, m: string) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const c1 = a.generateWorkflowCode(nodes, edges, {}).code ?? a.generateWorkflowCode(nodes, edges, {});
const c2 = b.generateWorkflowSDKCode("w", nodes, edges);
console.log(Object.keys(a.generateWorkflowCode(nodes, edges, {})), JSON.stringify(String(c1)).slice(0,300));
for (const [name, c] of [["codegen", String(c1)], ["codegen-sdk", String(c2)]]) { ok(/Unir[\s\S]*NOT exported/i.test(c), `${name}: Unir flagged as not exported`); ok(!/TODO: Implement action type "Unir"/.test(c), `${name}: no generic TODO`); }
for (const [name, c] of [["codegen", String(c1)], ["codegen-sdk", String(c2)]]) ok(/throw new Error\("Export not supported: this flow uses a Unir/.test(c), `${name}: export refuses to run (guard throws)`);
const nu = nodes.filter((x) => x.id !== "u"); const eu = edges.filter((x) => x.target !== "u");
for (const [name, c] of [["codegen", String(a.generateWorkflowCode(nu, eu, {}).code)], ["codegen-sdk", String(b.generateWorkflowSDKCode("w", nu, eu))]]) ok(!/Export not supported|unirNotSupported/.test(c), `${name}: a flow WITHOUT Unir is exported unchanged (no guard)`);
import ts from "typescript";
for (const [name, c] of [["codegen", String(c1)], ["codegen-sdk", String(c2)]]) { let good = true; const d = ts.transpileModule(c, { reportDiagnostics: true, compilerOptions: { target: 99 } }).diagnostics ?? []; if (d.length) { good = false; console.log(d.map((x: any) => String(x.messageText)).join("; ").slice(0, 300)); } ok(good, `${name}: output with the guard is syntactically valid TS`); }
console.log(f ? `${f} FAILED` : "ALL PASS"); process.exit(f ? 1 : 0);
