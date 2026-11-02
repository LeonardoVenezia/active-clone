// @ts-nocheck
const m: any = await import("../../lib/manual-input"); const { prepareInput } = m.default ?? m;
let fails = 0; const ok = (c: boolean, t: string) => { console.log(`${c ? "PASS" : "FAIL"} ${t}`); if (!c) fails++; };
const sent = { sku: "A-1", precio: "12.5", activo: "false", alta: "2026-11-02" }; // what the submit route forwards (validated, flat text)
{ const p = prepareInput([{ key: "sku", label: "sku", required: true }, { key: "precio", label: "precio", required: false }], sent); ok(JSON.stringify(p.input) === '{"sku":"A-1","precio":"12.5"}' && !p.missing.length, "I1 Manual with inputFields keeps only declared keys (existing behavior)"); }
{ const p = prepareInput([{ key: "activo", label: "activo", required: true }], sent); ok(p.input.activo === "false", 'I2 booleans arrive as "true"/"false" text (a raw boolean would be dropped by the Manual rules)'); }
{ const p = prepareInput([{ key: "sku", label: "sku", required: true }], { sku: 7 }); ok(p.input.sku === "7", "I3 Manual already turns numbers into text, so text numbers match existing behavior"); }
{ const p = prepareInput([{ key: "otro", label: "otro", required: true }], sent); ok(p.missing.length === 1, "I4 a required inputField the form does not send blocks the run (400), after the record is saved"); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
