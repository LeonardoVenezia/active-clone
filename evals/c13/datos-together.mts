// @ts-nocheck
// Runs the REAL pgDatosRepo SQL against an in-process Postgres (PGlite). Validates SQL semantics sequentially
// (jsonb equality, numeric add, locks, ledger). It is NOT a concurrency test (PGlite is single-connection).
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const PG = process.env.PGLITE_DIR || "/tmp/pgl/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(PG);
const { drizzle } = await import("drizzle-orm/pglite");
const client = new PGlite();
await client.exec(`CREATE TABLE data_records (organization_id text NOT NULL, collection text NOT NULL, key text NOT NULL, value jsonb NOT NULL, updated_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, collection, key));`);
(globalThis as any).__db = drizzle(client);
const stub = r.resolve("./stubs/pg-db-stub.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (q === "@/lib/db") return stub; if (q === "server-only") return r.resolve("../semantic/stubs/server-only.ts"); return o.call(this, q, ...a); };
const repo = (await import("../../lib/datos/repo")).pgDatosRepo; const core = await import("../../lib/datos/core");
const { datosApplyTogether, memoryRepo, DATOS_LIMITS } = (core as any).default ?? core;
let fails = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const O = "o1";
const add = (key: string, amount: number, extra: any = {}) => ({ operation: "add", collection: "inv", key, field: "n", amount, ...extra });
const sia = (c: string, key: string, value: any) => ({ operation: "saveIfAbsent", collection: c, key, value });
const uim = (c: string, key: string, expected: any, value: any) => ({ operation: "updateIfMatches", collection: c, key, expected, value });
async function suite(label: string, repo: any, count: (c: string) => Promise<number>) {
  const T = (id: string, ops: any, opId?: string) => datosApplyTogether(repo, O, { operations: ops, operationId: opId }, true);
  await repo.put(O, "inv", "a", { n: 10 }); await repo.put(O, "inv", "b", { n: 5 }); await repo.put(O, "st", "s1", { v: "old" });
  let x: any = await T("1", [add("a", -3, { min: 0 }), add("b", 2), uim("st", "s1", { v: "old" }, { v: "new" }), sia("log", "L1", { ok: 1 })], "t1");
  ok(x.success && x.estado === "aplicado" && x.records.length === 4 && (await repo.get(O, "inv", "a")).value.n === 7 && (await repo.get(O, "inv", "b")).value.n === 7, `${label} T1 applied`);
  ok((await repo.get(O, "inv", "a")).value.n === 7 && (await repo.get(O, "inv", "b")).value.n === 7 && (await repo.get(O, "log", "L1")) !== null && (await repo.get(O, "st", "s1")).value.v === "new", `${label} T1b all four effects present`);
  // replay: same id same list, nothing re-applied
  x = await T("1", [add("a", -3, { min: 0 }), add("b", 2), uim("st", "s1", { v: "old" }, { v: "new" }), sia("log", "L1", { ok: 1 })], "t1");
  ok(x.estado === "aplicado" && x.repetido === true && (await repo.get(O, "inv", "a")).value.n === 7, `${label} T2 replay returns stored result, no second application`);
  // same id other list = conflict
  x = await T("1", [add("a", -1)], "t1"); ok(!x.success && /datos distintos/.test(x.error) && (await repo.get(O, "inv", "a")).value.n === 7, `${label} T3 same id other list = conflict, nothing written`);
  // rejection in the LAST op leaves earlier ops unwritten (min violated on b)
  x = await T("1", [add("a", -1), add("b", -100, { min: 0 }), sia("log", "L2", { z: 1 })], "t4");
  ok(x.success && x.estado === "rechazado" && x.operacion === 2 && /por debajo del mínimo/.test(x.motivo) && /ningún cambio/.test(x.motivo), `${label} T4 rejected naming op 2`);
  ok((await repo.get(O, "inv", "a")).value.n === 7 && (await repo.get(O, "inv", "b")).value.n === 7 && (await repo.get(O, "log", "L2")) === null, `${label} T5 no partial writes after rejection`);
  // rejected is terminal: replay gives same rejection even if data would now allow it
  await repo.put(O, "inv", "b", { n: 1000 });
  x = await T("1", [add("a", -1), add("b", -100, { min: 0 }), sia("log", "L2", { z: 1 })], "t4"); ok(x.estado === "rechazado" && x.repetido === true && (await repo.get(O, "log", "L2")) === null, `${label} T6 rejected result is replayed, not re-run`);
  // existing key for saveIfAbsent rejects the batch; CAS mismatch; missing
  x = await T("1", [add("a", -1), sia("log", "L1", { again: 1 })]); ok(x.estado === "rechazado" && /ya existe/.test(x.motivo) && (await repo.get(O, "inv", "a")).value.n === 7, `${label} T7 saveIfAbsent on existing rejects all`);
  x = await T("1", [add("a", -1), uim("st", "s1", { v: "other" }, { v: "x" })]); ok(x.estado === "rechazado" && /distinto del esperado/.test(x.motivo) && (await repo.get(O, "inv", "a")).value.n === 7, `${label} T8 CAS mismatch rejects all`);
  x = await T("1", [add("a", -1), add("nope", 1)]); ok(x.estado === "rechazado" && /no existe/.test(x.motivo) && (await repo.get(O, "inv", "a")).value.n === 7, `${label} T9 missing record rejects all`);
  // validation: duplicates, count, bad shape, empty — nothing written
  ok(!(await T("1", [add("a", 1), add("a", 2)])).success, `${label} T10 same collection+key twice refused`);
  ok(!(await T("1", Array.from({ length: DATOS_LIMITS.maxTogetherOps + 1 }, (_, i) => sia("lim", `k${i}`, 1)))).success && (await count("lim")) === 0, `${label} T11 more than ${DATOS_LIMITS.maxTogetherOps} ops refused`);
  ok(!(await T("1", [])).success && !(await T("1", [{ operation: "save", collection: "inv", key: "a", value: 1 }])).success && !(await T("1", [sia("Bad Name", "k", 1)])).success, `${label} T12 empty / unsupported kind / bad name refused`);
  ok(!(await T("1", [sia("lim", "big", "x".repeat(DATOS_LIMITS.maxValueBytes + 1))])).success && (await count("lim")) === 0, `${label} T13 16 KB value cap`);
  ok(!(await datosApplyTogether(repo, "", { operations: [sia("lim", "z", 1)], operationId: "q" }, true)).success && !(await datosApplyTogether(repo, O, { operations: [sia("lim", "z", 1)], operationId: "q" }, false)).success && (await count("lim")) === 0, `${label} T14 closed without org / flag off`);
  // operations as JSON string (as the node config delivers it)
  x = await datosApplyTogether(repo, O, { operations: JSON.stringify([sia("js", "k", { a: 1 })]), operationId: "tjs" }, true); ok(x.estado === "aplicado" && (await count("js")) === 1, `${label} T15 JSON string list accepted`);
  // quota: collection at 5000 -> creating a new key rejects the batch and rolls back the others
  for (let i = 0; i < 5000; i += 500) await Promise.all(Array.from({ length: 500 }, (_, j) => repo.put(O, "full", `k${i + j}`, i + j)));
  x = await T("1", [add("a", -1), sia("full", "new", 1)]); ok(x.estado === "rechazado" && /5000/.test(x.motivo) && (await repo.get(O, "inv", "a")).value.n === 7 && (await count("full")) === 5000, `${label} T16 5000-record quota rejects whole batch`);
  // snapshot cap: many ~16KB results exceed the stored snapshot: whole thing rolled back
  const big = (i: number) => sia("bigc", `k${i}`, { s: "x".repeat(15000) });
  x = await T("1", [big(1), big(2), big(3)], "tbig"); ok(!x.success && /demasiado grande/.test(x.error) && (await count("bigc")) === 0, `${label} T17 snapshot too large: nothing written`);
  // two ops through a saved-fields collection: validation per defined field
  await repo.put(O, "$schemas", "typed", { fields: [{ name: "n", type: "numero", required: true }] });
  x = await T("1", [sia("typed", "k", { n: "texto" })]); ok(!x.success && (await count("typed")) === 0, `${label} T18 defined fields respected`);
}
{ const r = memoryRepo(); await suite("[offline memory]", r, (c) => r.count(O, c)); }
{ await suite("[PGlite SQL]", repo, async (c) => (await client.query("select count(*)::int c from data_records where organization_id=$1 and collection=$2", [O, c])).rows[0].c); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
