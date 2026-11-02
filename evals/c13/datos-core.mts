// @ts-nocheck
const m: any = await import("../../lib/datos/core"); const { datosList, datosRead, datosSave, memoryRepo, DATOS_LIMITS } = m.default ?? m;
let fails = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const repo = memoryRepo();
{ const r = await datosSave(repo, "orgA", { collection: "sku", key: "ABC-1", value: '{"stock":3}' }, true); ok(r.success && (r as any).record.value.stock === 3, "D1 save parses a JSON string and stores an object"); }
{ await datosSave(repo, "orgB", { collection: "sku", key: "ABC-1", value: { stock: 99 } }, true);
  const a = await datosRead(repo, "orgA", { collection: "sku", key: "ABC-1" }, true) as any, b = await datosRead(repo, "orgB", { collection: "sku", key: "ABC-1" }, true) as any;
  ok(a.record.value.stock === 3 && b.record.value.stock === 99, "D2 same collection/key in two organizations stays separate"); }
{ const l = await datosList(repo, "orgA", { collection: "sku" }, true) as any; ok(l.count === 1 && l.records[0].key === "ABC-1", "D3 list only returns the caller's organization"); }
{ const r = await datosSave(repo, "orgA", { collection: "sku", key: "ABC-1", value: "texto libre" }, true) as any; const g = await datosRead(repo, "orgA", { collection: "sku", key: "ABC-1" }, true) as any;
  ok(r.success && g.record.value === "texto libre" && (await datosList(repo, "orgA", { collection: "sku" }, true) as any).count === 1, "D4 saving the same key updates it (no duplicate); plain text is kept as text"); }
for (const [org, why] of [[undefined, "undefined"], ["", "empty"], ["  ", "blank"], [null, "null"], [42, "number"]] as const) { const r = await datosSave(repo, org, { collection: "sku", key: "x", value: 1 }, true); ok(!r.success, `D5 closed without a server-resolved organization (${why})`); }
{ const r = await datosSave(repo, "orgA", { collection: "sku", key: "x", value: 1 }, false); ok(!r.success, "D6 feature flag off: closed by default"); }
for (const c of ["", "Sku", "a b", "../x", "a".repeat(41), "sku;drop", 5 as any]) { const r = await datosSave(repo, "orgA", { collection: c, key: "k", value: 1 }, true); ok(!r.success, `D7 bad collection rejected (${String(c).slice(0, 12)})`); }
for (const k of ["", "a b", "a/b", "k".repeat(121), "{{x}}"]) { const r = await datosSave(repo, "orgA", { collection: "sku", key: k, value: 1 }, true); ok(!r.success, `D8 bad key rejected (${k.slice(0, 12)})`); }
{ const r = await datosSave(repo, "orgA", { collection: "sku", key: "big", value: "x".repeat(DATOS_LIMITS.maxValueBytes + 1) }, true); ok(!r.success, "D9 value over 16 KB rejected"); }
{ const small = memoryRepo(); const orig = DATOS_LIMITS.maxRecordsPerCollection; ok(orig === 5000, "D10 cap constant is 5000"); }
{ const r = memoryRepo(); for (let i = 0; i < 5; i++) await datosSave(r, "o", { collection: "c", key: `k${i}`, value: i }, true);
  const l1 = await datosList(r, "o", { collection: "c", limit: 2 }, true) as any, l2 = await datosList(r, "o", { collection: "c", limit: 99999 }, true) as any, l3 = await datosList(r, "o", { collection: "c", limit: "x" }, true) as any;
  ok(l1.count === 2 && l1.records[0].key === "k4", "D11 list is newest first and honors limit") ; ok(l2.count === 5 && l3.count === 5, "D12 huge or invalid limit is clamped/defaulted"); }
{ const g = await datosRead(repo, "orgA", { collection: "sku", key: "nope" }, true) as any; ok(g.success && g.found === false && g.record === null, "D13 reading a missing key is not an error"); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
