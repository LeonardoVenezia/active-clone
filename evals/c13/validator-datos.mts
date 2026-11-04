// @ts-nocheck
// Offline: the builder's validateFlow against a Datos applyTogether flow that reads the step outputs "estado"/"repetido"/"operacion".
const v: any = await import("../../lib/flow-validator"); const { validateFlow } = v.default ?? v;
const t = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "T", config: { triggerType: "Manual" } } };
const mk = (id: string, label: string, config: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label, config } });
const run = (field: string) => {
  const nodes = [t, mk("d1", "Aplicar", { actionType: "Datos", operation: "applyTogether", operations: "[]" }), mk("c1", "Se aplicó", { actionType: "Condition", condition: `{{@d1:Aplicar.${field}}} === 'aplicado'` })];
  const edges = [{ id: "a", source: "t", target: "d1" }, { id: "b", source: "d1", target: "c1" }];
  return validateFlow(nodes, edges, {}, new Set(["Condition", "Datos", "Fórmula"]));
};
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
for (const f of ["estado", "repetido", "operacion", "motivo", "records", "creado", "actualizado", "aplicado", "valor", "found", "record", "count"]) { const e = run(f); console.log(f, JSON.stringify(e).slice(0, 200)); ok(!e.some((x: string) => x.includes(`.${f}`) || /campo|field|unknown/i.test(x)), `validator accepts Datos output "${f}"`); }
const bad = run("inventado"); ok(bad.some((x: string) => x.includes("inventado")), 'validator still rejects an invented Datos field');
process.exit(fails ? 1 : 0);
