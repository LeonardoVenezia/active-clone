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
const { datosSaveIfAbsent, datosUpdateIfMatches, datosAdd, datosSave } = (core as any).default ?? core;
let fails = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const O = "o1", C = "c1";
let x: any = await datosSave(repo, O, { collection: C, key: "a", value: { n: 1, t: "7", s: "x" } }, true); ok(x.success, "S1 Guardar through putWithQuota (new)");
x = await datosSave(repo, O, { collection: C, key: "a", value: { n: 2, t: "7", s: "x" } }, true); ok(x.success && (await repo.count(O, C)) === 1, "S2 Guardar overwrites existing, no duplicate");
x = await datosSaveIfAbsent(repo, O, { collection: C, key: "b", value: { v: 1 } }, true); ok(x.creado === true, "S3 saveIfAbsent creates");
x = await datosSaveIfAbsent(repo, O, { collection: C, key: "b", value: { v: 9 } }, true); ok(x.creado === false && x.record.value.v === 1, "S4 saveIfAbsent keeps existing");
x = await datosUpdateIfMatches(repo, O, { collection: C, key: "b", expected: '{"v":1.0}', value: { v: 2 } }, true); ok(x.actualizado === true && x.record.value.v === 2, "S5 CAS jsonb equality (1.0 equals 1)");
x = await datosUpdateIfMatches(repo, O, { collection: C, key: "b", expected: { v: 1 }, value: { v: 3 } }, true); ok(x.actualizado === false && x.record.value.v === 2, "S6 CAS mismatch leaves value");
x = await datosUpdateIfMatches(repo, O, { collection: C, key: "zz", expected: 1, value: 3 }, true); ok(x.actualizado === false && x.record === null, "S7 CAS missing");
const add = (a: any) => datosAdd(repo, O, { collection: C, key: "a", field: "n", amount: 1, ...a }, true);
x = await add({}); ok(x.aplicado && x.valor === 3 && x.record.value.s === "x", "S8 add +1, other fields kept");
x = await add({ amount: 0.1 }); x = await add({ amount: 0.2 }); ok(x.aplicado && x.valor === 3.3, `S9 decimals exact (${x.valor})`);
x = await datosAdd(repo, O, { collection: C, key: "a", field: "t", amount: 1 }, true); ok(!x.aplicado && /no es un número/.test(x.motivo) && (await repo.get(O, C, "a")).value.t === "7", "S10 text field never converted");
x = await datosAdd(repo, O, { collection: C, key: "a", field: "new", amount: 1 }, true); ok(!x.aplicado && /no existe/.test(x.motivo), "S11 missing field no default");
x = await datosAdd(repo, O, { collection: C, key: "a", field: "new", amount: 4, startAtZero: true }, true); ok(x.aplicado && x.valor === 4, "S12 startAtZero");
x = await add({ amount: -1000, min: 0 }); ok(!x.aplicado && /mínimo/.test(x.motivo), "S13 min rejects");
x = await add({ amount: 1000, max: 10 }); ok(!x.aplicado && /máximo/.test(x.motivo), "S14 max rejects");
x = await datosAdd(repo, O, { collection: C, key: "nope", field: "n", amount: 1 }, true); ok(!x.aplicado && /no existe/.test(x.motivo), "S15 missing record");
await repo.put(O, C, "big", { n: 9007199254740991 }); x = await datosAdd(repo, O, { collection: C, key: "big", field: "n", amount: 1 }, true); ok(!x.aplicado, `S16 beyond safe range rejected (${x.motivo})`);
await repo.put(O, C, "dig", { n: 0.1234567890123456 }); x = await datosAdd(repo, O, { collection: C, key: "dig", field: "n", amount: 1 }, true); ok(!x.aplicado && /precisión/.test(x.motivo) && (await repo.get(O, C, "dig")).value.n === 0.1234567890123456, `S17 digits that would be lost rejected, unchanged (${x.motivo})`);
await repo.put(O, C, "arr", [1]); x = await datosAdd(repo, O, { collection: C, key: "arr", field: "n", amount: 1 }, true); ok(!x.aplicado, "S18 array record rejected");
const ad = (id: any) => datosAdd(repo, O, { collection: C, key: "a", field: "n", amount: 10, operationId: id }, true);
const before = (await repo.get(O, C, "a")).value.n; const p1 = await ad("e1|n1"), p2 = await ad("e1|n1"), p3 = await ad("e1|n2");
ok(p1.aplicado && p2.aplicado && p2.repetido && p3.aplicado && (await repo.get(O, C, "a")).value.n === before + 20, "S19 same operation id applies once (ledger), another id applies");
const led = (await client.query("select count(*)::int c from data_records where collection='$ops'")).rows; ok(led[0].c === 2, "S20 one durable row per protected operation");
for (let i = 0; i < 60; i++) await ad(`w${i}`); const again = await ad("e1|n1"); ok(again.aplicado && again.repetido && again.valor === p1.valor, "S21 durable: replay after 60 other operations returns the stored first result");
const nv = (await repo.get(O, C, "a")).value.n; const failed = await datosAdd(repo, O, { collection: C, key: "a", field: "n", amount: -100000, min: 0, operationId: "rej1" }, true); const cnt = (await client.query("select count(*)::int c from data_records where collection='$ops'")).rows[0].c;
const cfx: any = await datosAdd(repo, O, { collection: C, key: "a", field: "n", amount: 99, operationId: "e1|n1" }, true); ok(!cfx.success && /datos distintos/.test(cfx.error), "S21d same operation id, different payload: conflict error");
ok(!failed.aplicado && (await repo.get(O, C, "a")).value.n === nv && cnt === 63, "S21b rejected op: no data change, terminal rejection stored");
await client.query(`INSERT INTO data_records(organization_id,collection,key,value) VALUES ('o1','c1','hp','{"n": 0.12345678901234567890}')`); const hp = await datosAdd(repo, O, { collection: C, key: "hp", field: "n", amount: 0 }, true);
ok(!hp.aplicado && /precisión/.test(hp.motivo), `S21c stored decimal with more digits than a double: rejected before any conversion (${hp.motivo})`);
x = await repo.insertIfAbsent(O, "q", "k1", 1, 2); x = await repo.insertIfAbsent(O, "q", "k2", 1, 2); const f = await repo.insertIfAbsent(O, "q", "k3", 1, 2); ok(f.status === "full" && (await repo.count(O, "q")) === 2, "S22 quota (limit 2): third insert refused");
const f2 = await repo.putWithQuota(O, "q", "k4", 1, 2); const f3 = await repo.putWithQuota(O, "q", "k1", 5, 2); ok(f2.status === "full" && f3.status === "saved", "S23 putWithQuota shares the quota; overwrite at limit allowed");
ok((await repo.count("o2", C)) === 0 && (await repo.get("o2", C, "a")) === null, "S24 organization isolation");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);

// ---- replay contract in real SQL
{ await repo.put(O, C, "rp", { n: 0 }); const m1 = await datosAdd(repo, O, { collection: C, key: "rp", field: "n", amount: -1, min: 0, operationId: "rpA" }, true);
  await repo.put(O, C, "rp", { n: 9 }); const m2 = await datosAdd(repo, O, { collection: C, key: "rp", field: "n", amount: -1, min: 0, operationId: "rpA" }, true);
  ok(!m1.aplicado && !m2.aplicado && m2.repetido && (await repo.get(O, C, "rp")).value.n === 9, "S30 stored rejection replays as rejection after state changed (SQL)");
  await repo.put(O, C, "ab", "A"); const u = (id, e, v) => datosUpdateIfMatches(repo, O, { collection: C, key: "ab", expected: e, value: v, operationId: id }, true);
  const c1 = await u("ab1", "A", "B"); await u("ab2", "B", "A"); const c3 = await u("ab1", "A", "B");
  ok(c1.actualizado && c3.actualizado && c3.repetido && (await repo.get(O, C, "ab")).value === "A", "S31 CAS ABA replay does not re-apply (SQL)");
  const sa = (id, v) => datosSaveIfAbsent(repo, O, { collection: C, key: "so", value: v, operationId: id }, true);
  const t1 = await sa("so1", 1), t2 = await sa("so1", 1), t3 = await sa("so2", 1), t4 = await sa("so1", 2);
  ok(t1.creado && t2.creado && t2.repetido && !t3.creado && !t4.success, "S32 saveIfAbsent replay keeps creado=true; other id exists; other payload conflict (SQL)");
  const rows = (await client.query("select count(*)::int c from data_records where collection='$ops'")).rows[0].c;
  await client.query(`INSERT INTO data_records(organization_id,collection,key,value) SELECT 'o1','$ops','fill'||g,'{"fp":"x","r":{}}' FROM generate_series(1,${5000 - rows}) g`);
  const full = await datosAdd(repo, O, { collection: C, key: "rp", field: "n", amount: 1, operationId: "capNew" }, true); const rep = await datosAdd(repo, O, { collection: C, key: "a", field: "n", amount: 10, operationId: "e1|n1" }, true);
  ok(!full.success && /5000 operaciones protegidas/.test(full.error) && rep.aplicado && rep.repetido, "S33 cap 5000 per company: new op refused with clear error; stored op still replays (SQL)");
  const other = await datosAdd(repo, "o2", { collection: C, key: "rp", field: "n", amount: 1, operationId: "capNew" }, true); ok(other.success && /no existe/.test(other.motivo), "S34 cap is per company (other company not blocked by it)");
}
{ await repo.put(O, C, "sn", { n: 1, tag: "x" }); const a1 = await datosAdd(repo, O, { collection: C, key: "sn", field: "n", amount: 1, operationId: "sn1" }, true); await repo.put(O, C, "sn", { n: 50, tag: "changed" });
  const a2 = await datosAdd(repo, O, { collection: C, key: "sn", field: "n", amount: 1, operationId: "sn1" }, true);
  ok(a2.repetido && JSON.stringify(a2.record) === JSON.stringify(a1.record) && a2.valor === 2 && a2.record.value.tag === "x", "S35 replay returns the stored full output snapshot (record + valor of the first run), not current data (SQL)");
  const bg = { a: "x".repeat(16000) }; await repo.put(O, C, "bg", bg); const b1 = await datosUpdateIfMatches(repo, O, { collection: C, key: "bg", expected: bg, value: { a: "y".repeat(16000) }, operationId: "bg1" }, true); const b2 = await datosUpdateIfMatches(repo, O, { collection: C, key: "bg", expected: bg, value: { a: "y".repeat(16000) }, operationId: "bg1" }, true);
  ok(b1.actualizado && b2.actualizado && b2.repetido, "S36 ~16 KB value + snapshot stored and replayed (SQL)"); }
