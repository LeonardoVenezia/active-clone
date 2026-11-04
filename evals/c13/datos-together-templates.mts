// @ts-nocheck
// Offline: REAL executeWorkflow resolves {{@...}} references inside the "aplicar cambios juntos" list (config.operations),
// (templates are resolved by config key, so a capture step stands in for the Datos step; the real step fail-closed path is covered separately). Then the resolved config goes through the REAL datosApplyTogether with the in-memory repo (typed result, no code execution).
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const st = (n: string) => r.resolve(`../../evals/c13/stubs/${n}.ts`);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/step-registry$/, st("engine-step-registry")], [/^workflow$/, st("engine-workflow")], [/steps\/trigger$/, st("engine-trigger")], [/steps\/approval$/, st("engine-approval")], [/step-handler$/, st("engine-step-handler")], [/steps\/datos$/, st("engine-datos-step")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
const ex: any = await import("../../lib/workflow-executor.workflow"); const { executeWorkflow } = ex.default ?? ex;
const tc: any = await import("../../lib/datos/together-config"); const { serializeTogether, parseTogether, validateTogether } = tc.default ?? tc;
const core: any = await import("../../lib/datos/core"); const { datosApplyTogether, memoryRepo } = core.default ?? core;
process.env.DATOS_STORAGE_ENABLED = "true";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const trig = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "T", config: { triggerType: "Manual" }, status: "idle" } };
const node = (id: string, config: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id.toUpperCase(), status: "idle", config } });
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
async function resolved(srcData: any, rows: any[]) {
  (globalThis as any).__datosSeen = [];
  (globalThis as any).__H = { "test/src": async () => ({ success: true, ...srcData }), "test/cap": async (i: any) => { (globalThis as any).__datosSeen.push(i); return { success: true }; } };
  const nodes = [trig, node("src", { actionType: "test/src" }), node("d", { actionType: "test/cap", operation: "applyTogether", operations: serializeTogether(rows) })];
  const edges = [{ id: "a", source: "t", target: "src" }, { id: "b", source: "src", target: "d" }];
  const rl = console.log, re = console.error; console.log = () => {}; console.error = () => {};
  try { const R = await Promise.race([executeWorkflow({ nodes, edges, triggerInput: {}, workflowId: "w", dataOrganizationId: "orgQ" }), sleep(5000)]); (globalThis as any).__R = R; } finally { console.log = rl; console.error = re; }
  if (!(globalThis as any).__datosSeen?.[0]) console.log("DBG", JSON.stringify((globalThis as any).__R)?.slice(0, 600));
  return (globalThis as any).__datosSeen?.[0]?.operations;
}
const ref = (f: string) => `{{@src:SRC.${f}}}`;
const NASTY = 'He said "hi" \\ back\\slash\nnew\tline \u0001 end';
const base = (extra: any) => ({ operation: "saveIfAbsent", collection: "t1", key: "k1", ...extra });
{
  const ops = await resolved({ s: NASTY, n: 5, obj: { a: 1, t: 'x"y' }, neg: -3 }, [
    base({ key: "k1", value: ref("s") }),
    base({ key: "k2", value: ref("obj") }),
    { operation: "add", collection: "t1", key: "k3", field: "n", amount: ref("neg"), startAtZero: true, min: "-10" },
    base({ key: "k4", value: `{"txt": "${ref("s")}"}` }),
  ]);
  ok(typeof ops === "string" && (() => { try { JSON.parse(ops); return true; } catch { return false; } })(), "T1 operations stays valid JSON after resolving quotes/backslashes/newlines/control chars");
  const parsed = JSON.parse(ops);
  ok(parsed[0].value === NASTY, "T2 text with quotes+backslash+newline+tab+control char arrives byte-for-byte (typed string)");
  ok(parsed[1].value === '{"a":1,"t":"x\\"y"}', "T3 object reference arrives as its JSON text");
  ok(parsed[2].amount === "-3", "T4 number reference arrives as a numeric string");
  ok(parsed[3].value.txt === NASTY, "T5 reference inside a JSON value (stored as real JSON) keeps the exact text, quotes and all");
  const repo = memoryRepo(); await repo.put("orgQ", "t1", "k3", {});
  const x: any = await datosApplyTogether(repo, "orgQ", { operations: ops, operationId: "w1" }, true);
  ok(x.success && x.estado === "aplicado", "T6 resolved list is applied through the real datosApplyTogether");
  ok((await repo.get("orgQ", "t1", "k1")).value === NASTY && (await repo.get("orgQ", "t1", "k2")).value.t === 'x"y' && (await repo.get("orgQ", "t1", "k3")).value.n === -3 && (await repo.get("orgQ", "t1", "k4")).value.txt === NASTY, "T7 stored values: text exact, object typed, number summed, nested text exact");
}
{ // injection-shaped text stays data: it cannot add a change or change the operation
  const evil = '"},{"operation":"add","collection":"t1","key":"EVIL","field":"n","amount":"999","startAtZero":true},{"x":"';
  const ops = await resolved({ s: evil }, [base({ key: "k1", value: ref("s") })]);
  const parsed = JSON.parse(ops);
  ok(parsed.length === 1 && parsed[0].value === evil, "T8 text shaped like extra JSON stays a single value (no extra change injected)");
  const repo = memoryRepo(); const x: any = await datosApplyTogether(repo, "orgQ", { operations: ops, operationId: "w2" }, true);
  ok(x.estado === "aplicado" && (await repo.get("orgQ", "t1", "EVIL")) === null && (await repo.count("orgQ", "t1")) === 1, "T9 nothing beyond the declared change is written");
}
{ // missing reference: left as typed text, no crash
  const ops = await resolved({}, [base({ key: "k1", value: ref("nope") })]);
  ok(typeof ops === "string" && JSON.parse(ops).length === 1, "T10 unresolved reference does not break the list");
}
{ // editor <-> config round trip and shapes
  const rows = [{ operation: "saveIfAbsent", collection: "c", key: "k", value: '{"a": 1, "b": ["x"]}' }, { operation: "updateIfMatches", collection: "c", key: "k2", expected: "plain text", value: "[1,2]" }, { operation: "add", collection: "c", key: "k3", field: "n", amount: "-1", min: "0", startAtZero: true }];
  const w = JSON.parse(serializeTogether(rows));
  ok(typeof w[0].value === "object" && w[0].value.a === 1 && w[1].expected === "plain text" && Array.isArray(w[1].value) && w[2].amount === "-1" && w[2].min === "0" && w[2].startAtZero === true && !("max" in w[2]), "T11 JSON text is stored as real JSON, plain text stays text, add keeps only its fields");
  const back = parseTogether(serializeTogether(rows));
  ok(back.length === 3 && back[0].value === '{"a":1,"b":["x"]}' && back[1].expected === "plain text" && back[2].amount === "-1", "T12 parse(serialize(rows)) gives the same rows");
  ok(parseTogether("not json") === null && JSON.stringify(parseTogether("")) === "[]" && parseTogether('[{"x":1}]') === null, "T13 unreadable lists are reported as null (editor falls back to raw JSON), empty is an empty list");
}
{ // inline validation
  const good = { operation: "add", collection: "productos", key: "SKU-1", field: "stock", amount: "-1", min: "0" };
  ok(validateTogether([good]).errors[0].length === 0, "V1 a valid change has no messages");
  const v = validateTogether([{ ...good, collection: "Prod ucts", key: "a/b", field: "st ock", amount: "x", min: "5", max: "1" }, { ...good }, { ...good }, { operation: "saveIfAbsent", collection: "c", key: "k", value: "{bad" }, { operation: "updateIfMatches", collection: "c", key: "k2", expected: "", value: "" }]);
  const j = (i: number) => v.errors[i].join(" | ");
  ok(/colección usa solo/.test(j(0)) && /clave usa/.test(j(0)) && /campo usa/.test(j(0)) && /cantidad debe ser un número/.test(j(0)) && /mínimo no puede ser mayor/.test(j(0)), "V2 bad collection/key/field/amount/min-max each get a readable message");
  ok(v.errors[1].length === 0 && /cambio 2/.test(j(2)), "V3 duplicate collection+key points at the earlier change");
  ok(/parece JSON pero no es válido/.test(j(3)) && /Falta el valor esperado/.test(j(4)) && /Falta el valor\./.test(j(4)), "V4 invalid JSON hint, missing expected/new value");
  ok(validateTogether([{ ...good, key: "{{@src:SRC.sku}}", amount: "{{@src:SRC.n}}", min: "{{@src:SRC.m}}" }]).errors[0].length === 0, "V5 references are accepted where a value is resolved at run time");
  ok(validateTogether([]).general.length === 1 && validateTogether(Array.from({ length: 11 }, (_, i) => ({ ...good, key: "k" + i }))).general.length === 1, "V6 empty list and more than 10 are flagged");
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
