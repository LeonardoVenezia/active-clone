// @ts-nocheck
// Offline, no model calls, no network. Reproduces how the REAL executor (lib/workflow-executor.workflow.ts processTemplates, sliced from source)
// treats Datos config shapes, then applies the result with the real Datos core on the in-memory repo.
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync } from "node:fs"; import ts from "typescript";
const r = createRequire(import.meta.url);
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (/^server-only$/.test(q)) return r.resolve("typescript"); return o.call(this, q, ...a); };
process.env.DATOS_STORAGE_ENABLED = "true";
const src = readFileSync(new URL("../../lib/workflow-executor.workflow.ts", import.meta.url), "utf8");
const a = src.indexOf("const JSON_STRING_CONFIG_KEYS"); const b = src.indexOf("/**\n * Main workflow executor function");
if (a < 0 || b < 0) { console.log("FAIL could not slice processTemplates from the executor"); process.exit(1); }
const js = ts.transpileModule(src.slice(a, b), { compilerOptions: { target: "ES2022" } }).outputText;
const { resolveFieldValue } = await import("../../lib/field-path");
const processTemplates = new Function("resolveFieldValue", js + "\nreturn processTemplates;")(resolveFieldValue);
const core: any = await import("../../lib/datos/core"); const { datosApplyTogether, datosRead, memoryRepo } = core.default ?? core;
const bc: any = await import("../../lib/agent/build-core"); const { shadowApply } = bc.default ?? bc;
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const outputs = (cant: unknown, extra: any = {}) => ({ trig: { label: "T", data: { plataforma: "tn", pedido: "7", linea: "L1", tipo: "venta", sku: "S1", cantidad: cant, ...extra } } });
const ops = [{ operation: "saveIfAbsent", collection: "movimientos", key: "{{@trig:T.plataforma}}:{{@trig:T.pedido}}:{{@trig:T.linea}}:{{@trig:T.tipo}}", value: { sku: "{{@trig:T.sku}}" } }, { operation: "add", collection: "saldos", key: "{{@trig:T.sku}}", field: "stock", amount: "-{{@trig:T.cantidad}}", min: "0" }];
const run = async (operations: unknown, out: any, stock = 5) => {
  const cfg: any = processTemplates({ operation: "applyTogether", operations }, out);
  const repo = memoryRepo(); await repo.insertIfAbsent("org", "saldos", "S1", { stock }, 5000);
  const res: any = await datosApplyTogether(repo, "org", { operations: cfg.operations, operationId: "x" });
  const s: any = await datosRead(repo, "org", { collection: "saldos", key: "S1" });
  return { cfg, res, stock: s.record?.value?.stock };
};
// 1. string form (what the editor stores): the signed template becomes a real negative number and the stock really drops 5 -> 3
const t1 = await run(JSON.stringify(ops), outputs(2));
ok(typeof t1.cfg.operations === "string" && /"amount":"-2"/.test(t1.cfg.operations), "string form: amount resolves to -2");
ok(t1.res.success && t1.res.estado === "aplicado" && t1.stock === 3, `string form: stock 5 -> 3 (got ${t1.stock}, ${t1.res.estado})`);
// 2. real array form (what the model emits): the executor does NOT resolve references inside it
const t2 = await run(ops, outputs(2));
ok(JSON.stringify(t2.cfg.operations).includes("{{@trig:T.cantidad}}"), "array form: references stay unresolved in the executor (reproduced)");
ok(!(t2.res.success && t2.res.estado === "aplicado" && t2.stock === 3), `array form: does not produce the intended result (success=${t2.res.success}, estado=${t2.res.estado}, stock=${t2.stock})`);
// 3. the builder normalizes the array into the string form, and then the same run works
const sh: any = { nodes: [], edges: [] };
shadowApply({ op: "addNode", node: { id: "d", type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: "D", config: { actionType: "Datos", operation: "applyTogether", operations: JSON.parse(JSON.stringify(ops)) } } } } as any, sh);
ok(typeof sh.nodes[0].data.config.operations === "string", "builder addNode: array operations serialized to a JSON string");
const t3 = await run(sh.nodes[0].data.config.operations, outputs(2));
ok(t3.res.success && t3.res.estado === "aplicado" && t3.stock === 3, `normalized by the builder: stock 5 -> 3 (got ${t3.stock})`);
shadowApply({ op: "updateNode", nodeId: "d", updates: { data: { config: { operations: JSON.parse(JSON.stringify(ops)) } } } } as any, sh);
ok(typeof sh.nodes[0].data.config.operations === "string", "builder updateNode: array operations serialized too");
// 4. numeric edge cases of the signed template
const t4 = await run(JSON.stringify(ops), outputs("-2")); ok(!(t4.res.success && t4.res.estado === "aplicado") , `quantity already negative ("--2") is rejected, not added (estado=${t4.res.estado}, stock=${t4.stock})`);
const t5 = await run(JSON.stringify(ops), outputs(undefined)); ok(!(t5.res.success && t5.res.estado === "aplicado") && t5.stock === 5, `missing quantity is rejected, stock unchanged (stock=${t5.stock})`);
const t6 = await run(JSON.stringify(ops), outputs("2abc")); ok(!(t6.res.success && t6.res.estado === "aplicado") && t6.stock === 5, `non numeric quantity rejected (stock=${t6.stock})`);
const t7 = await run(JSON.stringify(ops), outputs(9)); ok(t7.stock === 5 && t7.res.estado === "rechazado", `insufficient balance (min 0) rejected, stock unchanged (estado=${t7.res.estado}, stock=${t7.stock})`);
// 5. raw JSON: a quoted reference is escaped; a reference with quotes in its data still parses
const ops8 = JSON.parse(JSON.stringify(ops)); ops8[0].value.nota = "{{@trig:T.nota}}";
const t8 = await run(JSON.stringify(ops8), outputs(2, { nota: 'dice "hola"\nchau' }));
ok(t8.res.success && t8.res.estado === "aplicado" && t8.stock === 3, `quote/newline inside a quoted reference does not break the JSON and applies (estado=${t8.res.estado}, stock=${t8.stock})`);
// 6. raw JSON risk: a reference NOT inside quotes (typed by hand as text) with a quote in its data
const rawText = '[{"operation":"saveIfAbsent","collection":"movimientos","key":"k1","value":{"sku":{{@trig:T.sku}}}}]';
const cfgRaw: any = processTemplates({ operations: rawText }, outputs(2, { sku: 'S"1' }));
let parsed = true; try { JSON.parse(cfgRaw.operations); } catch { parsed = false; }
console.log(`INFO unquoted reference with a quote in its data -> JSON.parse ${parsed ? "ok" : "fails"} (reproduced; the executor then rejects the step)`);
ok(!parsed, "unquoted reference with quote data: JSON is invalid (reproduced) and must be rejected, not partially applied");
const resRaw: any = await datosApplyTogether(memoryRepo(), "org", { operations: cfgRaw.operations, operationId: "y" });
ok(!(resRaw.success && resRaw.estado === "aplicado"), `unparseable operations are not applied (success=${resRaw.success}, error=${String(resRaw.error).slice(0, 60)})`);
process.exit(fails ? 1 : 0);
