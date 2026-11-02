// @ts-nocheck
// Offline: the REAL Datos step (lib/steps/datos) with memory storage; fields op needs the server-granted flag.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/datos\/repo$/, r.resolve("./stubs/get-repo.ts")], [/step-handler$/, r.resolve("./stubs/engine-step-handler.ts")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
process.env.DATOS_STORAGE_ENABLED = "true";
const core: any = await import("../../lib/datos/core"); const c = core.default ?? core;
const st: any = await import("../../lib/steps/datos"); const { datosStep } = st.default ?? st;
const pol: any = await import("../../lib/datos/frontend"); const { canDefineDatosFields } = pol.default ?? pol;
let fails = 0; const ok = (b: boolean, m: string) => { if (!b) fails++; console.log(`${b ? "PASS" : "FAIL"} ${m}`); };
const repo = (globalThis as any).__repo;
const def = (flag: any) => datosStep({ operation: "fields", collection: "prod", fields: "a:texto:obligatorio", _dataOrganizationId: "org1", _dataCanDefineFields: flag });
for (const [name, flag] of [["not granted (member/manager/share)", false], ["undefined", undefined], ['string "true"', "true"], ["1", 1]] as const) { const x = await def(flag); ok(x.success === false && /Dueño o un Admin/.test(x.error) && (await c.datosGetFields(repo, "org1", "prod")) === null, `R1 define refused, nothing stored (${name})`); }
{ const x = await def(true); ok(x.success === true && (await c.datosGetFields(repo, "org1", "prod"))?.length === 1, "R2 granted (owner/admin): fields stored"); }
{ await datosStep({ operation: "fields", collection: "prod", fields: "a:texto,b:numero", _dataOrganizationId: "org1", _dataCanDefineFields: false }); ok((await c.datosGetFields(repo, "org1", "prod")).length === 1, "R3 a refused redefinition leaves the existing fields untouched"); }
{ const x = await datosStep({ operation: "save", collection: "prod", key: "k", value: { a: "x" }, _dataOrganizationId: "org1", _dataCanDefineFields: false }); ok(x.success === true, "R4 saving data does not need the permission (only defining fields does)"); }
ok(canDefineDatosFields("owner") && canDefineDatosFields("admin"), "R5 owner and admin may define fields");
for (const role of ["member", "manager", "operator", "Owner", "", null, undefined, 1]) ok(!canDefineDatosFields(role), `R6 role ${JSON.stringify(role)} may not define fields`);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
