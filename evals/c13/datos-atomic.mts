// @ts-nocheck
// Offline contract tests for the 3 atomic Datos ops with the in-memory repo.
// These prove validation and contract only. They do NOT prove atomicity (see the real concurrency test).
const m: any = await import("../../lib/datos/core"); const { datosRead, exactSum, datosSaveIfAbsent, datosUpdateIfMatches, datosAdd, datosSave, datosDefineFields, memoryRepo, DATOS_LIMITS } = m.default ?? m;
let fails = 0; const ok = (c: boolean, msg: string) => { console.log(`${c ? "PASS" : "FAIL"} ${msg}`); if (!c) fails++; };
const O = "orgA", C = { collection: "sku" };
{ const r = memoryRepo();
  const a: any = await datosSaveIfAbsent(r, O, { ...C, key: "k", value: { n: 1 } }, true); ok(a.success && a.creado && a.record.value.n === 1, "A1 creates when absent");
  const b: any = await datosSaveIfAbsent(r, O, { ...C, key: "k", value: { n: 2 } }, true); ok(b.success && !b.creado && b.record.value.n === 1, "A2 exists: unchanged, returns the existing record");
  const c: any = await datosSaveIfAbsent(r, "orgB", { ...C, key: "k", value: { n: 9 } }, true); ok(c.creado, "A3 other organization is separate");
  ok(!(await datosSaveIfAbsent(r, O, { ...C, key: "a/b", value: 1 }, true)).success, "A4 bad key rejected");
  ok(!(await datosSaveIfAbsent(r, O, { ...C, key: "big", value: "x".repeat(DATOS_LIMITS.maxValueBytes + 1) }, true)).success, "A5 16 KB enforced");
  ok(!(await datosSaveIfAbsent(r, "", { ...C, key: "z", value: 1 }, true)).success && !(await datosSaveIfAbsent(r, O, { ...C, key: "z", value: 1 }, false)).success, "A6 closed without org / flag off");
}
{ const r = memoryRepo(); for (let i = 0; i < 5000; i++) await r.put(O, "full", `k${i}`, i);
  const f: any = await datosSaveIfAbsent(r, O, { collection: "full", key: "new", value: 1 }, true); ok(!f.success && /5000/.test(f.error) && (await r.count(O, "full")) === 5000, "A7 at 5000: clear error, nothing deleted");
  const e: any = await datosSaveIfAbsent(r, O, { collection: "full", key: "k1", value: 1 }, true); ok(e.success && !e.creado, "A8 at 5000 an existing key still returns the existing record");
}
{ const r = memoryRepo(); await datosDefineFields(r, O, { collection: "typed", fields: "nombre:texto:obligatorio\nprecio:numero" }, true);
  ok(!(await datosSaveIfAbsent(r, O, { collection: "typed", key: "k", value: { otro: 1 } }, true)).success, "A9 respects defined fields");
}
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "k", value: { estado: "pendiente", n: 1 } }, true);
  const a: any = await datosUpdateIfMatches(r, O, { ...C, key: "k", expected: '{"estado":"pendiente","n":1.0}', value: { estado: "pagado", n: 2 } }, true); ok(a.success && a.actualizado && a.record.value.estado === "pagado", "B1 matches (1 equals 1.0 semantic): updates");
  const b: any = await datosUpdateIfMatches(r, O, { ...C, key: "k", expected: { estado: "pendiente", n: 1 }, value: { estado: "x" } }, true); ok(b.success && !b.actualizado && b.record.value.estado === "pagado" && /distinto/.test(b.motivo), "B2 mismatch: false, reason, current record, unchanged");
  const c: any = await datosUpdateIfMatches(r, O, { ...C, key: "nope", expected: 1, value: 2 }, true); ok(c.success && !c.actualizado && c.record === null && /no existe/.test(c.motivo), "B3 missing record: false with reason");
  const d: any = await datosUpdateIfMatches(r, O, { ...C, key: "k", expected: { estado: "pagado", n: 2 }, value: "x".repeat(20000) }, true); ok(!d.success, "B4 new value validated (16 KB)");
  const e: any = await datosUpdateIfMatches(r, O, { ...C, key: "k", expected: { n: 2, estado: "pagado" }, value: { z: 1 } }, true); ok(e.actualizado, "B5 key order does not matter");
  await datosSave(r, O, { ...C, key: "t", value: "1" }, true);
  const t: any = await datosUpdateIfMatches(r, O, { ...C, key: "t", expected: "1", value: "2" }, true); ok(t.actualizado, "B6 expected parsed like Guardar (string JSON 1 equals stored 1)");
  await datosDefineFields(r, O, { collection: "typed", fields: "n:numero" }, true); await datosSave(r, O, { collection: "typed", key: "k", value: { n: 1 } }, true);
  ok(!(await datosUpdateIfMatches(r, O, { collection: "typed", key: "k", expected: { n: 1 }, value: { q: 1 } }, true)).success, "B7 new value validated against defined fields");
}
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "s", value: { stock: 5, nombre: "x", t: "7" } }, true);
  const add = (a: any) => datosAdd(r, O, { ...C, key: "s", field: "stock", amount: 1, ...a }, true);
  let x: any = await add({ amount: -2 }); ok(x.success && x.aplicado && x.valor === 3 && x.record.value.nombre === "x", "C1 subtracts, keeps other fields");
  x = await add({ amount: 0.1 }); x = await add({ amount: 0.2 }); ok(x.aplicado, "C2 decimals accepted");
  x = await add({ amount: "2" }); ok(x.aplicado, "C3 numeric string amount (from templates) accepted");
  for (const bad of ["abc", "", NaN, Infinity, null, undefined, "1e3", {}]) { x = await add({ amount: bad }); ok(!x.success, `C4 bad amount rejected (${String(bad)})`); }
  x = await add({ amount: 2 ** 60 }); ok(!x.success, "C5 amount beyond safe range rejected");
  x = await datosAdd(r, O, { ...C, key: "s", field: "t", amount: 1 }, true); ok(x.success && !x.aplicado && /no es un número/.test(x.motivo) && (await r.get(O, "sku", "s")).value.t === "7", "C6 text field is never converted");
  x = await datosAdd(r, O, { ...C, key: "s", field: "nombre", amount: 1 }, true); ok(!x.aplicado, "C7 non numeric field rejected");
  x = await datosAdd(r, O, { ...C, key: "s", field: "nuevo", amount: 1 }, true); ok(!x.aplicado && /no existe/.test(x.motivo), "C8 missing field does not start at 0 by default");
  x = await datosAdd(r, O, { ...C, key: "s", field: "nuevo", amount: 4, startAtZero: true }, true); ok(x.aplicado && x.valor === 4, "C9 missing field starts at 0 only if asked");
  const before = (await r.get(O, "sku", "s")).value.stock;
  x = await add({ amount: -1000, min: 0 }); ok(x.success && !x.aplicado && /mínimo/.test(x.motivo) && (await r.get(O, "sku", "s")).value.stock === before, "C10 min rejects, nothing changes");
  x = await add({ amount: 1000, max: 100 }); ok(!x.aplicado && /máximo/.test(x.motivo), "C11 max rejects");
  x = await add({ amount: 1, min: 10, max: 1 }); ok(!x.success, "C12 min > max rejected");
  x = await datosAdd(r, O, { ...C, key: "none", field: "stock", amount: 1 }, true); ok(!x.aplicado && /no existe/.test(x.motivo), "C13 missing record");
  x = await datosAdd(r, O, { ...C, key: "s", field: "a.b", amount: 1 }, true); ok(!x.success, "C14 no free paths: simple field names only");
  await datosSave(r, O, { ...C, key: "arr", value: [1] }, true); x = await datosAdd(r, O, { ...C, key: "arr", field: "stock", amount: 1 }, true); ok(!x.aplicado, "C15 non-object record rejected");
  await datosSave(r, O, { ...C, key: "big", value: { n: Number.MAX_SAFE_INTEGER } }, true); x = await datosAdd(r, O, { ...C, key: "big", field: "n", amount: 1 }, true); ok(!x.aplicado && /rango/.test(x.motivo), "C16 result beyond safe range: rejected, no silent loss");
  await datosDefineFields(r, O, { collection: "typed2", fields: "n:numero\nt:texto" }, true); await datosSave(r, O, { collection: "typed2", key: "k", value: { n: 1 } }, true);
  x = await datosAdd(r, O, { collection: "typed2", key: "k", field: "t", amount: 1 }, true); ok(!x.success, "C17 defined collection: field must be a numero field");
  x = await datosAdd(r, O, { collection: "typed2", key: "k", field: "n", amount: 1 }, true); ok(x.aplicado && x.valor === 2, "C18 defined numeric field works");
}
// Precision contract: exact decimal sums; anything that would lose digits when read back as a double is rejected.
ok(exactSum(0.1, 0.2) === 0.3 && exactSum(1.1, 2.2) === 3.3 && exactSum(-0.3, 0.1) === -0.2 && exactSum(1e-7, 2e-7) === 3e-7, "P1 exact decimal sums (0.1+0.2 = 0.3, not 0.30000000000000004)");
ok(exactSum(Number.MAX_SAFE_INTEGER, 1) === null && exactSum(0.1234567890123456, 1) === null && exactSum(9007199254740991, -1) === 9007199254740990, "P2 beyond-precision results rejected (null)");
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "p", value: { price: 0.1, big: 0.1234567890123456 } }, true);
  let x: any = await datosAdd(r, O, { ...C, key: "p", field: "price", amount: 0.2 }, true); ok(x.aplicado && x.valor === 0.3, "P3 Sumar 0.1 + 0.2 stores 0.3");
  x = await datosAdd(r, O, { ...C, key: "p", field: "big", amount: 1 }, true); ok(!x.aplicado && /precisión/.test(x.motivo) && (await r.get(O, "sku", "p")).value.big === 0.1234567890123456, "P4 digits that would be lost: rejected, record unchanged");
}
// Quota: Guardar (save) also respects 5000 via the same locked path
{ const r = memoryRepo(); for (let i = 0; i < 5000; i++) await r.put(O, "full2", `k${i}`, i);
  const f: any = await datosSave(r, O, { collection: "full2", key: "new", value: 1 }, true); ok(!f.success && (await r.count(O, "full2")) === 5000, "Q1 Guardar at 5000: clear error");
  ok((await datosSave(r, O, { collection: "full2", key: "k1", value: 7 }, true)).success, "Q2 Guardar at 5000 can still overwrite an existing key");
}
// Replay by operation id (stored terminal result is returned, applied or rejected)
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "o", value: { n: 10 } }, true);
  const add = (id: any, amount = -1, extra: any = {}) => datosAdd(r, O, { ...C, key: "o", field: "n", amount, operationId: id, ...extra }, true) as any;
  const a = await add("s1"), b = await add("s1"), c = await add("s2"), d = await add(undefined), e = await add(undefined);
  ok(a.aplicado && !a.repetido && b.aplicado && b.repetido && c.aplicado && d.aplicado && e.aplicado && (await r.get(O, "sku", "o")).value.n === 6, "R2 replay returns the stored result (aplicado, repetido) and does not add again; distinct ids apply; no id = no protection");
  for (let i = 0; i < 60; i++) await add(`x${i}`);
  const b2 = await add("s1"); ok(b2.aplicado && b2.repetido && b2.valor === a.valor, "R3 durable: replay after 60 other ops returns the SAME stored result (valor of the first run)");
  const cf: any = await add("s1", -5); ok(!cf.success && /datos distintos/.test(cf.error), "R4 same id with a different amount is a conflict (error)");
  // rejected op: the rejection is stored and replayed even if the state later changes
  await datosSave(r, O, { ...C, key: "rj", value: { n: 0 } }, true);
  const r1 = await add2(r, "rj", "rejA", -1, { min: 0 }); await datosSave(r, O, { ...C, key: "rj", value: { n: 50 } }, true);
  const r2 = await add2(r, "rj", "rejA", -1, { min: 0 });
  ok(!r1.aplicado && !r2.aplicado && r2.repetido && (await r.get(O, "sku", "rj")).value.n === 50, "R5 rejected result is stored: replay after the state changed does NOT apply (no branch flip, no double effect)");
}
async function add2(r: any, key: string, id: string, amount: number, extra: any) { return datosAdd(r, O, { ...C, key, field: "n", amount, operationId: id, ...extra }, true) as any; }
// Replay returns the FULL stored output, record included (not the current data)
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "f", value: { n: 1, tag: "x" } }, true);
  const a1: any = await datosAdd(r, O, { ...C, key: "f", field: "n", amount: 1, operationId: "f1" }, true); await datosSave(r, O, { ...C, key: "f", value: { n: 99, tag: "changed" } }, true);
  const a2: any = await datosAdd(r, O, { ...C, key: "f", field: "n", amount: 1, operationId: "f1" }, true);
  ok(a2.repetido && JSON.stringify(a2.record) === JSON.stringify(a1.record) && a2.valor === 2 && a2.record.value.tag === "x", "R12 replay output (record, valor) is the stored snapshot of the first run, not the current data");
  const s1: any = await datosSaveIfAbsent(r, O, { ...C, key: "g", value: { v: 1 }, operationId: "g1" }, true); await datosSave(r, O, { ...C, key: "g", value: { v: 2 } }, true); const s2: any = await datosSaveIfAbsent(r, O, { ...C, key: "g", value: { v: 1 }, operationId: "g1" }, true);
  ok(JSON.stringify(s2.record) === JSON.stringify(s1.record) && s2.record.value.v === 1, "R13 saveIfAbsent replay record is the first-run snapshot");
  const big = { a: "x".repeat(16000) }; await datosSave(r, O, { ...C, key: "h", value: big }, true);
  const c1: any = await datosUpdateIfMatches(r, O, { ...C, key: "h", expected: big, value: { a: "y".repeat(16000) }, operationId: "h1" }, true);
  ok(c1.actualizado && (await r.get(O, "sku", "h")).value.a[0] === "y", "R14 near-16KB values still fit with their snapshot"); }
// saveIfAbsent replay keeps creado=true (branch stable)
{ const r = memoryRepo(); const s1: any = await datosSaveIfAbsent(r, O, { ...C, key: "u", value: 1, operationId: "a1" }, true); const s2: any = await datosSaveIfAbsent(r, O, { ...C, key: "u", value: 1, operationId: "a1" }, true);
  const s3: any = await datosSaveIfAbsent(r, O, { ...C, key: "u", value: 1, operationId: "a2" }, true); const s4: any = await datosSaveIfAbsent(r, O, { ...C, key: "u", value: 2, operationId: "a1" }, true);
  ok(s1.creado && s2.creado && s2.repetido && !s3.creado && !s4.success, "R6 saveIfAbsent replay returns creado=true (stored), a new id sees it exists, other payload = conflict"); }
// CAS ABA: replay does not re-apply
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "c", value: "A" }, true);
  const u = (id: string, e: any, v: any) => datosUpdateIfMatches(r, O, { ...C, key: "c", expected: e, value: v, operationId: id }, true) as any;
  const x1 = await u("c1", "A", "B"); await u("c2", "B", "A"); const x3 = await u("c1", "A", "B");
  ok(x1.actualizado && x3.actualizado && x3.repetido && (await r.get(O, "sku", "c")).value === "A", "R7 CAS A->B->A then replay of the first: returns the stored result and does NOT re-apply (value stays A)");
  const miss = await u("c9", "Z", "Q"); await datosSave(r, O, { ...C, key: "c", value: "Z" }, true); const miss2 = await u("c9", "Z", "Q");
  ok(!miss.actualizado && !miss2.actualizado && miss2.repetido && (await r.get(O, "sku", "c")).value === "Z", "R8 CAS that did not match stays 'no match' on replay even if the value now matches"); }
// Pilot cap on protected operations
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "k", value: { n: 0 } }, true);
  for (let i = 0; i < 5000; i++) await datosAdd(r, O, { ...C, key: "k", field: "n", amount: 1, operationId: `p${i}` }, true);
  const over: any = await datosAdd(r, O, { ...C, key: "k", field: "n", amount: 1, operationId: "p5000" }, true); const old: any = await datosAdd(r, O, { ...C, key: "k", field: "n", amount: 1, operationId: "p0" }, true);
  const pl: any = await datosAdd(r, O, { ...C, key: "k", field: "n", amount: 1 }, true);
  ok(!over.success && /5000 operaciones protegidas/.test(over.error), "R9 op 5001 is refused with a clear error, nothing applied");
  ok(old.aplicado && old.repetido, "R10 replay of an already stored op still works at the cap (no new row needed)");
  ok(pl.aplicado && (await r.get(O, "sku", "k")).value.n === 5001, "R11 unprotected call (no id) is unaffected by the cap"); }
// Internal collections are unreachable from user ops
{ const r = memoryRepo(); for (const col of ["$ops", "$schemas", "$x"]) {
  const a: any[] = [await datosSave(r, O, { collection: col, key: "k", value: 1 }, true), await datosRead(r, O, { collection: col, key: "k" }, true), await datosSaveIfAbsent(r, O, { collection: col, key: "k", value: 1 }, true), await datosUpdateIfMatches(r, O, { collection: col, key: "k", expected: 1, value: 2 }, true), await datosAdd(r, O, { collection: col, key: "k", field: "n", amount: 1 }, true), await datosDefineFields(r, O, { collection: col, fields: "a:texto" }, true)];
  ok(a.every((x) => !x.success), `I1 collection ${col} rejected by every op`); } }
// Replay contract: gate Sumar with Guardar si no existe using a per-event key.
{ const r = memoryRepo(); await datosSave(r, O, { collection: "stock", key: "p1", value: { n: 10 } }, true);
  const deliver = async (ev: string) => { const g: any = await datosSaveIfAbsent(r, O, { collection: "eventos", key: ev, value: { ok: true } }, true); if (!g.creado) return "repetido"; await datosAdd(r, O, { collection: "stock", key: "p1", field: "n", amount: -1 }, true); return "aplicado"; };
  const out = [await deliver("ord_1"), await deliver("ord_1"), await deliver("ord_1"), await deliver("ord_2")];
  ok(out.join() === "aplicado,repetido,repetido,aplicado" && (await r.get(O, "stock", "p1")).value.n === 8, "R1 redelivered event applies once (gate by per-event key)");
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
