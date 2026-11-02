// @ts-nocheck
// Offline: REAL executeWorkflow. Explicit "Unir" node: waits for its input branches (all, or up to a timeout), builds one unified output. Other multi-parent steps keep the old behavior (run once on the first live parent).
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const st = (n: string) => r.resolve(`../../evals/c13/stubs/${n}.ts`);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/step-registry$/, st("engine-step-registry")], [/^workflow$/, st("engine-workflow")], [/steps\/trigger$/, st("engine-trigger")], [/steps\/approval$/, st("engine-approval")], [/step-handler$/, st("engine-step-handler")], [/steps\/datos$/, st("engine-datos-step")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
const ex: any = await import("../../lib/workflow-executor.workflow"); const { executeWorkflow } = ex.default ?? ex;
process.env.DATOS_STORAGE_ENABLED = "true";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const trig = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "T", config: { triggerType: "Manual" }, status: "idle" } };
const node = (id: string, config: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id.toUpperCase(), status: "idle", config } });
const e = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const CLOSED = "no pertenece a una empresa";
async function run(nodes: any[], extra: any = {}) {
  (globalThis as any).__H = { "test/step": async (i: any) => { (globalThis as any).__other = i; return { success: true }; } };
  const rl = console.log, re = console.error; console.log = () => {}; console.error = () => {};
  let R: any; try { R = await Promise.race([executeWorkflow({ nodes, edges: nodes.slice(1).map(n => e("t", n.id)), triggerInput: {}, workflowId: "w", ...extra }), sleep(5000).then(() => ({ results: {}, hang: true }))]); } finally { console.log = rl; console.error = re; }
  return { R, err: (id: string) => String(R?.results?.[id]?.error ?? ""), other: (globalThis as any).__other };
}
const save = (extra: any = {}) => node("d", { actionType: "Datos", operation: "save", collection: "sku", key: "k", value: "1", ...extra });
{ const x = await run([trig, save()], {}); ok(x.err("d").includes(CLOSED), "E1 no server-resolved organization: Datos fails closed"); }
{ const x = await run([trig, save({ _dataOrganizationId: "orgEvil", organizationId: "orgEvil", orgId: "orgEvil" })], {}); ok(x.err("d").includes(CLOSED), "E2 organization written in the node config is ignored (still closed)"); }
{ const x = await run([trig, save({ _dataOrganizationId: "orgEvil" })], { dataOrganizationId: "orgServer" }); ok(!x.R.hang && !x.err("d").includes(CLOSED) && !/select|organization_id|orgServer/i.test(x.err("d")), `E3 with a server organization the step gets past the guard and a storage failure shows no SQL or ids (${x.err("d").slice(0, 60)})`); }
{ const x = await run([trig, node("o", { actionType: "test/step", _dataOrganizationId: "orgEvil" })], { dataOrganizationId: "orgServer" }); ok(x.other && x.other._dataOrganizationId === undefined, "E4 other actions never receive the organization; a config value is stripped"); }
{ process.env.DATOS_STORAGE_ENABLED = "false"; const x = await run([trig, save()], { dataOrganizationId: "orgServer" }); ok(x.err("d").includes("no está habilitado"), "E5 flag off: closed even with an organization"); }
{ process.env.DATOS_STORAGE_ENABLED = "true"; const x = await run([trig, node("fr", { actionType: "Frontend", title: "P", collection: "sku" })], {}); ok(x.R?.results?.fr?.success === true && x.R.results.fr.data?.page === "/frontend/w", `E6 Frontend node runs as a no-op presentation step and reports its page (${JSON.stringify(x.R?.results?.fr?.data)})`); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
