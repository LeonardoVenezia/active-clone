// @ts-nocheck
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (/^server-only$/.test(q)) return r.resolve("../../evals/semantic/stubs/server-only.ts"); return o.call(this, q, ...a); };
const m: any = await import("../../lib/flow-validator"); const v = m.default ?? m;
const n = (id: string, cfg: any = {}, type = "action") => ({ id, type, position: { x: 0, y: 0 }, data: { type, label: id.toUpperCase(), config: cfg } });
const e = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
let f = 0; const ok = (c: boolean, msg: string) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"} ${msg}`); };
const T = n("t", { triggerType: "Manual" }, "trigger");
const run = (field: string) => v.validateFlow([T, n("d", { actionType: "Datos", operation: "add", collection: "c", key: "k", field: "n", amount: "1" }), n("c", { actionType: "Condition", condition: `{{@d:D.${field}}} == true` })], [e("t", "d"), e("d", "c")], {}, new Set(["Datos", "Condition"]));
for (const fld of ["aplicado", "creado", "actualizado", "valor", "motivo"]) ok(!run(fld).some((x: string) => /D\.|campo|field|no existe|output/i.test(x) && x.includes(fld)), `V1 Datos output "${fld}" accepted in a later node`);
ok(run("inventado").some((x: string) => x.includes("inventado")), "V2 unknown Datos output is still rejected");
console.log(f ? `\n${f} FAILED` : "\nALL PASS"); process.exit(f ? 1 : 0);
