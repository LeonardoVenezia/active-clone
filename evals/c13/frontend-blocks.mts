// @ts-nocheck
const m: any = await import("../../lib/datos/frontend"); const { frontendViewFromNodes } = m.default ?? m;
let fails = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const n = (cfg: any) => [{ data: { config: { actionType: "Frontend", collection: "prod", ...cfg } } }];
{ const v = frontendViewFromNodes(n({})); ok(v.columns.length === 0 && !v.showForm && !v.runOnSubmit && v.keyField === "", "B1 existing Frontend config (no new keys) keeps the basic table, no form"); }
{ const v = frontendViewFromNodes(n({ columns: "nombre, precio,nombre, ../x, a b, 9x,stock" })); ok(JSON.stringify(v.columns) === '["nombre","precio","stock"]', "B2 columns are de-duplicated and invalid names dropped"); }
{ const v = frontendViewFromNodes(n({ columns: Array.from({ length: 30 }, (_, i) => `c${i}`).join(",") })); ok(v.columns.length === 12, "B3 at most 12 columns"); }
{ const v = frontendViewFromNodes(n({ showForm: "true", runOnSubmit: "true", keyField: "sku" })); ok(v.showForm && v.runOnSubmit && v.keyField === "sku", "B4 form, run on submit and key field read"); }
{ const v = frontendViewFromNodes(n({ runOnSubmit: "true" })); ok(!v.runOnSubmit, "B5 run on submit is ignored when the form is off"); }
{ const v = frontendViewFromNodes(n({ showForm: "true", keyField: "bad key!" })); ok(v.keyField === "", "B6 invalid key field ignored"); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
