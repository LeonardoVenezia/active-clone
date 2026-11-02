// @ts-nocheck
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (/^server-only$/.test(q)) return r.resolve("../../evals/semantic/stubs/server-only.ts"); return o.call(this, q, ...a); };
const a: any = await import("../../lib/workflow-codegen"); const b: any = await import("../../lib/workflow-codegen-sdk");
const n = (id: string, cfg: any, type = "action") => ({ id, type, position: { x: 0, y: 0 }, data: { type, label: id, config: cfg, status: "idle" } });
let f = 0; const ok = (c: boolean, m: string) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const gen = (nodes: any[]) => { const edges = nodes.slice(1).map((x, i) => ({ id: `e${i}`, source: nodes[i].id, target: x.id })); const c1 = a.generateWorkflowCode(nodes, edges, {}); return [["codegen", String(c1.code ?? c1)], ["codegen-sdk", String(b.generateWorkflowSDKCode("w", nodes, edges))]]; };
for (const type of ["Datos", "Frontend"]) {
  for (const [name, c] of gen([n("t", { triggerType: "Manual" }, "trigger"), n("x", { actionType: type, collection: "sku" })])) {
    ok(new RegExp(`${type}[\\s\\S]*NOT exported`).test(c), `${name}: ${type} flagged as not exported`);
    ok(/Export not supported: this flow uses a Datos or Frontend node/.test(c), `${name}: ${type} export refuses to run (guard throws)`);
    ok(!/TODO: Implement action type/.test(c), `${name}: ${type} does not leave a silent TODO`);
  }
}
for (const [name, c] of gen([n("t", { triggerType: "Manual" }, "trigger"), n("d", { actionType: "Delay", durationSeconds: 1 })])) ok(!/Export not supported|platformOnlyNotSupported/.test(c), `${name}: a flow without Datos/Frontend gets no guard`);
console.log(f ? `\n${f} FAILED` : "\nALL PASS"); process.exit(f ? 1 : 0);
