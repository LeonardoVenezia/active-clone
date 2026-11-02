// @ts-nocheck
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/lib\/datos\/access$/, r.resolve("./stubs/route-access.ts")], [/lib\/datos\/repo$/, r.resolve("./stubs/get-repo.ts")], [/execute\/route$/, r.resolve("./stubs/route-execute.ts")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
process.env.DATOS_STORAGE_ENABLED = "true";
const core: any = await import("../../lib/datos/core"); const c = core.default ?? core;
const mod: any = await import("../../app/api/frontend/[workflowId]/submit/route"); const { POST } = mod.default ?? mod;
let fails = 0; const ok = (b: boolean, m: string) => { if (!b) fails++; console.log(`${b ? "PASS" : "FAIL"} ${m}`); };
const repo = (globalThis as any).__repo; const O = "https://app.example";
const good = { signedIn: true, anonymous: false, workflowExists: true, isOwner: true, hasShare: false, scopeOrganizationId: "org1", isMemberOfScopeOrg: true };
const node = (cfg: any = {}) => [{ data: { config: { actionType: "Frontend", collection: "prod", showForm: "true", ...cfg } } }];
await c.datosDefineFields(repo, "org1", { collection: "prod", fields: "sku:texto:obligatorio\nprecio:numero" }, true);
async function call(facts: any, nodes: any, values: any, headers: any = { origin: O }, raw?: string) {
  (globalThis as any).__facts = facts; (globalThis as any).__nodes = nodes; (globalThis as any).__exec = [];
  const res = await POST(new Request(`${O}/api/frontend/w1/submit`, { method: "POST", headers: { cookie: "s=1", ...headers }, body: raw ?? JSON.stringify({ values }) }), { params: Promise.resolve({ workflowId: "w1" }) });
  return { status: res.status, body: await res.json(), exec: (globalThis as any).__exec };
}
{ const x = await call(good, node({ keyField: "sku" }), { sku: "A-1", precio: "9.5" }); const g = await c.datosRead(repo, "org1", { collection: "prod", key: "A-1" }, true);
  ok(x.status === 200 && x.body.saved && g.record.value.precio === 9.5 && x.exec.length === 0, "S1 valid form saved to the server-resolved organization and collection, workflow NOT run when not asked"); }
{ const x = await call(good, node({ keyField: "sku" }), { sku: "A-2", precio: "1", organizationId: "org2", collection: "otra" }); ok(x.status === 400 && /no existe/.test(x.body.error), "S2 extra fields such as organizationId/collection are rejected, nothing saved"); }
{ const x = await call(good, node({ keyField: "sku" }), { sku: "A-2", precio: "1" }, { origin: O }, JSON.stringify({ values: { sku: "A-2", precio: "1" }, organizationId: "org2", collection: "otra" })); const bad = await c.datosRead(repo, "org2", { collection: "prod", key: "A-2" }, true); ok(x.status === 200 && bad.found === false && (await c.datosRead(repo, "org1", { collection: "prod", key: "A-2" }, true)).found, "S3 top-level organizationId/collection in the body are ignored"); }
{ const x = await call(good, node({ keyField: "sku" }), { precio: "1" }); ok(x.status === 400, "S4 missing required/key field refused"); }
{ const x = await call(good, node({ keyField: "sku" }), { sku: "A-9", precio: "abc" }); ok(x.status === 400 && (await c.datosRead(repo, "org1", { collection: "prod", key: "A-9" }, true)).found === false, "S5 invalid type refused, not saved"); }
{ const x = await call(good, node(), { sku: "auto", precio: "3" }); const l = await c.datosList(repo, "org1", { collection: "prod" }, true); ok(x.status === 200 && /^f-/.test(x.body.key) && l.count === 3, "S6 without keyField an automatic key is used"); }
{ const x = await call(good, node({ runOnSubmit: "true", keyField: "sku" }), { sku: "R-1", precio: "7" }); ok(x.status === 200 && x.body.started && x.exec.length === 1 && JSON.stringify(x.exec[0].body) === '{"input":{"sku":"R-1","precio":"7"}}' && x.exec[0].cookie === "s=1", "S7 runOnSubmit: workflow runs once with the VALIDATED values as flat text and the caller's session"); }
{ const x = await call(good, node({ keyField: "sku" }), { sku: "R-2", precio: "x" }); ok(x.exec.length === 0, "S8 invalid values never reach the workflow"); }
for (const [name, facts, nodes, headers, st] of [["no session", { ...good, signedIn: false }, node(), { origin: O }, 401], ["not a member", { ...good, isMemberOfScopeOrg: false }, node(), { origin: O }, 403], ["shared without membership", { ...good, isOwner: false, hasShare: true, isMemberOfScopeOrg: false }, node(), { origin: O }, 403], ["cross-origin", good, node(), { origin: "https://evil.example" }, 403], ["no Origin", good, node(), {}, 403], ["form off", good, node({ showForm: "false" }), { origin: O }, 404], ["no Frontend node", good, [{ data: { config: { actionType: "Condition" } } }], { origin: O }, 404]] as const) {
  const before = (await c.datosList(repo, "org1", { collection: "prod" }, true)).count; const x = await call(facts, nodes, { sku: "Z", precio: "1" }, headers); const after = (await c.datosList(repo, "org1", { collection: "prod" }, true)).count; ok(x.status === st && before === after && x.exec.length === 0, `S9 refused (${name}): ${x.status}, nothing saved, workflow not run`); }
{ const x = await call(good, node(), null, { origin: O }, "no es json"); ok(x.status === 400, "S10 malformed body: 400"); }
{ const x = await call(good, node(), null, { origin: O }, JSON.stringify({ values: { sku: "x".repeat(25000) } })); ok(x.status === 413, "S11 oversized body: 413"); }
await c.datosSave(repo, "org1", { collection: "libre2", key: "k", value: "x" }, true);
{ const x = await call(good, [{ data: { config: { actionType: "Frontend", collection: "libre2", showForm: "true" } } }], { a: "1" }); ok(x.status === 400 && /campos definidos/.test(x.body.error), "S12 form on a collection without fields: refused with a clear message"); }
process.env.DATOS_STORAGE_ENABLED = "false"; { const x = await call(good, node(), { sku: "F", precio: "1" }); ok(x.status === 404, "S13 flag off: closed"); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
