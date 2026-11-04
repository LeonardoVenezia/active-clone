// @ts-nocheck
// Offline focused regression for the executor change: (A) differential processTemplates, origin/main vs this branch, over NON-Datos configs
// (must be identical); (B) Datos configs WITHOUT format tags (legacy) must differ only in value/expected text handling; (C) real executeWorkflow linear chain + parallel branches.
// The saved prod-graph snapshots (engine-join/engine-linear) are not used and their results are not claimed.
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync } from "node:fs"; import ts from "typescript";
const r = createRequire(import.meta.url); const st = (n: string) => r.resolve(`../../evals/c13/stubs/${n}.ts`);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/step-registry$/, st("engine-step-registry")], [/^workflow$/, st("engine-workflow")], [/steps\/trigger$/, st("engine-trigger")], [/steps\/approval$/, st("engine-approval")], [/step-handler$/, st("engine-step-handler")], [/steps\/datos$/, st("engine-datos-step")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const { resolveFieldValue } = await import("../../lib/field-path"); const { jsonFormatTag } = await import("../../lib/datos/value-format");
function load(src: string) {
  const a = src.indexOf("const JSON_STRING_CONFIG_KEYS"); const b = src.indexOf("/**\n * Main workflow executor function");
  const js = ts.transpileModule(src.slice(a, b), { compilerOptions: { target: "ES2022" } }).outputText;
  return new Function("resolveFieldValue", "datosJsonFormatTag", js + "\nreturn processTemplates;")(resolveFieldValue, jsonFormatTag);
}
const oldPt = load(readFileSync("/tmp/exec-main.ts", "utf8")); const newPt = load(readFileSync(new URL("../../lib/workflow-executor.workflow.ts", import.meta.url), "utf8"));
const outs = { a_1: { label: "A", data: { name: 'Ta"za', n: 3, b: true, z: null, list: [1, 2], obj: { k: "v" }, text: "hola\nmundo" } }, t: { label: "T", data: { id: 9 } } };
const R = (f: string) => `{{@a-1:A.${f}}}`;
const corpus: any[] = [
  { actionType: "slack/send-message", slackMessage: `Hola ${R("name")} x${R("n")}`, slackChannel: "#g" },
  { actionType: "HTTP Request", url: `https://x.test/${R("n")}`, body: `{"a":"${R("name")}","n":${R("n")}}`, headers: `{"X":"${R("text")}"}`, method: "POST" },
  { actionType: "HTTP Request", body: `{"o":${R("obj")},"l":${R("list")},"z":${R("z")}}` },
  { actionType: "Condition", condition: `${R("n")} > 2 && ${R("b")} === true` },
  { actionType: "Fórmula", formula: `${R("n")} * 2` },
  { actionType: "Database Query", query: `select * from t where id = ${R("n")}`, params: `[${R("n")}]` },
  { actionType: "x/y", value: `{"v":"${R("name")}"}`, expected: `${R("obj")}`, operations: `[{"a":"${R("n")}"}]` },
  { actionType: "x/y", missing: "{{@nope:N.f}}", partial: `a {{@a-1:A.nofield}} b`, nested: { deep: R("n") }, arr: [R("n"), "x"] },
  { actionType: "Loop", source: R("list"), maxItems: 5, steps: [{ config: { m: "{{@item:Item.x}}" } }] },
  { actionType: "Unir" }, { actionType: "Delay", durationSeconds: 1 }, { n: 1, s: "plain", b: false, nul: null },
];
const run = (pt: any, c: any) => JSON.stringify(pt(JSON.parse(JSON.stringify(c)), outs));
corpus.forEach((c, i) => ok(run(oldPt, c) === run(newPt, c), `A${i + 1} non-Datos config identical to origin/main (${c.actionType ?? "plain"})`));
// B: Datos legacy (no tags): what changed vs main is only the value/expected string handling
const dl = { actionType: "Datos", operation: "save", collection: "c", key: R("n"), value: `{"v":"${R("name")}"}` };
const bo = JSON.parse(run(oldPt, dl)), bn = JSON.parse(run(newPt, dl));
ok(bo.key === bn.key && bo.collection === bn.collection, "B1 Datos legacy: key/collection identical to main");
ok(bn.value !== bo.value ? (() => { try { JSON.parse(bn.value); return true; } catch { return false; } })() : true, `B2 Datos legacy value: main=${bo.value} branch=${bn.value} (branch must be valid JSON when it differs)`);
const dr = { actionType: "Datos", operation: "read", collection: "c", key: R("n") };
ok(run(oldPt, dr) === run(newPt, dr), "B3 Datos read identical to main");
// C: real executeWorkflow
const ex: any = await import("../../lib/workflow-executor.workflow"); const { executeWorkflow } = ex.default ?? ex;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const trig = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "T", config: { triggerType: "Manual" }, status: "idle" } };
const node = (id: string, config: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id.toUpperCase(), status: "idle", config } });
const ed = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
const seen: any = {};
(globalThis as any).__H = { "test/step": async (i: any) => { seen[i.tag] = i; return { success: true, out: `${i.tag}-out`, n: i.n ?? 1 }; } };
const quiet = async (f: any) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await f(); } finally { console.log = l; console.error = e; } };
{ const nodes = [trig, node("a", { actionType: "test/step", tag: "a", n: 4 }), node("b", { actionType: "test/step", tag: "b", from: "{{@a:A.out}}", count: "{{@a:A.n}}", msg: "x {{@a:A.out}}" })];
  const R1: any = await quiet(() => Promise.race([executeWorkflow({ nodes, edges: [ed("t", "a"), ed("a", "b")], triggerInput: {}, workflowId: "w" }), sleep(5000).then(() => ({ hang: true }))]));
  ok(!R1.hang && seen.b?.from === "a-out" && String(seen.b?.count) === "4" && seen.b?.msg === "x a-out", `C1 linear chain resolves references (${JSON.stringify(seen.b)?.slice(0, 120)})`); }
{ const nodes = [trig, node("p", { actionType: "test/step", tag: "p" }), node("q", { actionType: "test/step", tag: "q" }), node("u", { actionType: "Unir" }), node("c", { actionType: "test/step", tag: "c", pv: "{{@u:Unir.inputs.p.out}}", qv: "{{@u:Unir.inputs.q.out}}" })];
  const R2: any = await quiet(() => Promise.race([executeWorkflow({ nodes, edges: [ed("t", "p"), ed("t", "q"), ed("p", "u"), ed("q", "u"), ed("u", "c")], triggerInput: {}, workflowId: "w" }), sleep(5000).then(() => ({ hang: true }))]));
  ok(!R2.hang && seen.c?.pv === "p-out" && seen.c?.qv === "q-out", `C2 parallel branches + Unir: step after Unir reads both (${JSON.stringify([seen.c?.pv, seen.c?.qv])})`); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
