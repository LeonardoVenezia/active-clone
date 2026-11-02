// @ts-nocheck
const m: any = await import("../../lib/datos/core"); const { datosSave, datosRead, datosList, datosDefineFields, datosGetFields, memoryRepo } = m.default ?? m;
const f: any = await import("../../lib/datos/fields"); const { parseFieldSpec } = f.default ?? f;
let fails = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const repo = memoryRepo(); const O = "orgA";
// compatibility: a collection without fields behaves as before
await datosSave(repo, O, { collection: "libre", key: "a", value: "texto" }, true); await datosSave(repo, O, { collection: "libre", key: "b", value: { x: [1, 2] } }, true);
ok((await datosList(repo, O, { collection: "libre" }, true)).count === 2, "F1 collection WITHOUT fields still accepts text and any JSON");
// old records survive a later definition
await datosSave(repo, O, { collection: "prod", key: "viejo", value: "registro libre previo" }, true);
const def = await datosDefineFields(repo, O, { collection: "prod", fields: "nombre:texto:obligatorio\nprecio:numero\nactivo:booleano\nalta:fecha" }, true);
ok(def.success && def.fields.length === 4, "F2 define fields");
ok((await datosRead(repo, O, { collection: "prod", key: "viejo" }, true)).record.value === "registro libre previo", "F3 defining fields does NOT rewrite or delete earlier records");
const good = await datosSave(repo, O, { collection: "prod", key: "p1", value: { nombre: "Taza", precio: "12.5", activo: "true", alta: "2026-11-02" } }, true);
ok(good.success && good.record.value.precio === 12.5 && good.record.value.activo === true, "F4 valid object saved; numbers and booleans normalized from text");
for (const [why, v] of [["missing required", { precio: 1 }], ["unknown field", { nombre: "x", extra: 1 }], ["bad number", { nombre: "x", precio: "abc" }], ["bad boolean", { nombre: "x", activo: "quizas" }], ["bad date", { nombre: "x", alta: "2026-02-31" }], ["date wrong format", { nombre: "x", alta: "02/11/2026" }], ["not an object (text)", "hola"], ["not an object (list)", [1]], ["text too long", { nombre: "x".repeat(1001) }], ["number as text field", { nombre: 5 }], ["Infinity", { nombre: "x", precio: "Infinity" }]] as const) {
  const r = await datosSave(repo, O, { collection: "prod", key: "bad", value: v }, true); ok(!r.success, `F5 rejected: ${why}`); }
ok((await datosRead(repo, O, { collection: "prod", key: "bad" }, true)).found === false, "F6 a rejected value is not stored");
ok((await datosSave(repo, O, { collection: "prod", key: "p2", value: '{"nombre":"Vaso"}' }, true)).success, "F7 JSON string value is parsed then validated");
// isolation
ok((await datosGetFields(repo, "orgB", "prod")) === null && (await datosSave(repo, "orgB", { collection: "prod", key: "z", value: "libre" }, true)).success, "F8 fields of one organization do not apply to another");
// reserved
for (const op of [() => datosSave(repo, O, { collection: "$schemas", key: "prod", value: { fields: [] } }, true), () => datosRead(repo, O, { collection: "$schemas", key: "prod" }, true), () => datosList(repo, O, { collection: "$schemas" }, true), () => datosDefineFields(repo, O, { collection: "$schemas", fields: "a:texto" }, true)]) ok(!(await op()).success, "F9 internal $schemas collection is not reachable as a normal collection");
// compatibility: collections starting with "_" keep working
ok((await datosSave(repo, O, { collection: "_mia", key: "k", value: 1 }, true)).success && (await datosRead(repo, O, { collection: "_mia", key: "k" }, true)).found, "F9b existing-style collection names starting with _ still work (no reservation)");
// spec parsing
for (const bad of ["", "nombre", "nombre:cosa", "1x:texto", "a:texto:raro", "a:texto,a:numero", "a:texto:obligatorio:x", Array.from({ length: 21 }, (_, i) => `c${i}:texto`).join(",")]) ok(!parseFieldSpec(bad).ok, `F10 bad spec rejected (${bad.slice(0, 18)})`);
ok(parseFieldSpec("a:texto, b:numero:obligatorio").ok, "F11 comma-separated spec accepted");
ok(!(await datosDefineFields(repo, O, { collection: "x", fields: "a:texto" }, false)).success && !(await datosDefineFields(repo, null, { collection: "x", fields: "a:texto" }, true)).success, "F12 define closed when flag off or no organization");
// redefining changes only future saves
await datosDefineFields(repo, O, { collection: "prod", fields: "nombre:texto" }, true);
ok((await datosRead(repo, O, { collection: "prod", key: "p1" }, true)).record.value.precio === 12.5 && !(await datosSave(repo, O, { collection: "prod", key: "p3", value: { nombre: "a", precio: 1 } }, true)).success, "F13 redefining affects only new saves; stored records untouched");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
