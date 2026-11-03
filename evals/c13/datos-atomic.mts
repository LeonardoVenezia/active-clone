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
// Replay by operation id (same executionId|nodeId delivered twice)
{ const r = memoryRepo(); await datosSave(r, O, { ...C, key: "o", value: { n: 10 } }, true);
  const add = (id: any) => datosAdd(r, O, { ...C, key: "o", field: "n", amount: -1, operationId: id }, true) as any;
  const a = await add("exec1|node1"), b = await add("exec1|node1"), c = await add("exec1|node2"), d = await add(undefined), e = await add(undefined);
  ok(a.aplicado && !b.aplicado && b.repetido && /ya se aplicó/.test(b.motivo) && c.aplicado && d.aplicado && e.aplicado && (await r.get(O, "sku", "o")).value.n === 6, "R2 same operation id applies once; distinct ids apply; no id = no dedupe");
  for (let i = 0; i < 60; i++) await add(`x${i}`);
  ok(!(await add("exec1|node1")).aplicado, "R3 durable: replay after 60 other operations on the same record is still ignored (no window)");
}
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
