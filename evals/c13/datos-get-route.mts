// @ts-nocheck
// Offline: the REAL GET /api/datos handler with access and storage stubbed (memory repo).
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/lib\/datos\/access$/, r.resolve("./stubs/get-access.ts")], [/lib\/datos\/repo$/, r.resolve("./stubs/get-repo.ts")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
process.env.DATOS_STORAGE_ENABLED = "true";
const core: any = await import("../../lib/datos/core"); const c = core.default ?? core;
const mod: any = await import("../../app/api/datos/route"); const { GET } = mod.default ?? mod;
let fails = 0; const ok = (b: boolean, m: string) => { if (!b) fails++; console.log(`${b ? "PASS" : "FAIL"} ${m}`); };
const repo = (globalThis as any).__repo;
await c.datosSave(repo, "org1", { collection: "sku", key: "A", value: { n: 1 } }, true);
await c.datosSave(repo, "org1", { collection: "secret", key: "S", value: "private" }, true);
await c.datosSave(repo, "org2", { collection: "sku", key: "B", value: { n: 2 } }, true);
const nodes = [{ data: { config: { actionType: "Frontend", collection: "sku", title: "Stock" } } }];
const get = async (ctx: any, qs = "workflowId=w1") => { (globalThis as any).__ctx = ctx; const res = await GET(new Request(`https://app.example/api/datos?${qs}`)); return { status: res.status, body: await res.json() }; };
{ const x = await get({ organizationId: "org1", userId: "u", nodes }); ok(x.status === 200 && x.body.records.length === 1 && x.body.records[0].key === "A" && x.body.view.title === "Stock", "G1 authorized: only the Frontend node's collection, only the caller's organization"); }
{ const x = await get({ organizationId: "org1", userId: "u", nodes }, "workflowId=w1&collection=secret&organizationId=org2"); ok(x.status === 200 && x.body.records.length === 1 && x.body.records[0].key === "A", "G2 collection and organization in the query string are ignored"); }
{ const x = await get(null); ok(x.status === 403 && !x.body.records, "G3 no access (no session / not a member / not shared): 403, no data"); }
{ const x = await get({ organizationId: "org1", userId: "u", nodes: [{ data: { config: { actionType: "Condition" } } }] }); ok(x.status === 404, "G4 workflow without a Frontend node: 404"); }
{ const x = await get(null, ""); ok(x.status === 403, "G5 missing workflowId: 403"); }
process.env.DATOS_STORAGE_ENABLED = "false"; { const x = await get({ organizationId: "org1", userId: "u", nodes }); ok(x.status === 200 && x.body.enabled === false && x.body.records.length === 0, "G6 flag off: no data"); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
