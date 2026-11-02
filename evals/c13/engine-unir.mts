// @ts-nocheck
// Offline: REAL executeWorkflow. Explicit "Unir" node: waits for its input branches (all, or up to a timeout), builds one unified output. Other multi-parent steps keep the old behavior (run once on the first live parent).
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const st = (n: string) => r.resolve(`../../evals/c13/stubs/${n}.ts`);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/step-registry$/, st("engine-step-registry")], [/^workflow$/, st("engine-workflow")], [/steps\/trigger$/, st("engine-trigger")], [/steps\/approval$/, st("engine-approval")], [/step-handler$/, st("engine-step-handler")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
const ex: any = await import("../../lib/workflow-executor.workflow"); const { executeWorkflow } = ex.default ?? ex;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const trig = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "T", config: { triggerType: "Manual" }, status: "idle" } };
const act = (id: string, ms = 5, extra: any = {}) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id.toUpperCase(), status: "idle", config: { actionType: "test/step", delay: String(ms), ...extra } } });
const cond = (id: string, v: boolean) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id.toUpperCase(), status: "idle", config: { actionType: "Condition", condition: v ? "1 === 1" : "1 === 2" } } });
const e = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
const unir = (id: string, extra: any = {}) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id.toUpperCase(), status: "idle", config: { actionType: "Unir", ...extra } } });
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
async function run(nodes: any[], edges: any[], failIds: string[] = []) {
  const ev: string[] = []; const seen: Record<string, any> = {}; const t0 = Date.now();
  (globalThis as any).__H = { "test/step": async (i: any) => { const id = i.__id; await sleep(Number(i.delay)); ev.push(`done:${id}`); if (failIds.includes(id)) return { success: false, error: "boom" }; return { success: true, v: id.toUpperCase() }; } };
  // the handler needs the node id: carry it in config
  for (const n of nodes) if (n.data.config?.actionType === "test/step") n.data.config.__id = n.id;
  const H = (globalThis as any).__H["test/step"]; (globalThis as any).__H["test/step"] = async (i: any) => { ev.push(`start:${i.__id}`); seen[i.__id] = i; return H(i); };
  const rl = console.log, re = console.error; console.log = () => {}; console.error = () => {};
  let res: any; try { res = await Promise.race([executeWorkflow({ nodes, edges, triggerInput: {}, workflowId: "w" }), sleep(6000).then(() => "HANG")]); } finally { console.log = rl; console.error = re; }


  return { ev, seen, res, ran: (id: string) => ev.includes(`start:${id}`), count: (id: string) => ev.filter(x => x === `start:${id}`).length, before: (a: string, b: string) => ev.indexOf(a) < ev.indexOf(b) && ev.indexOf(a) >= 0 };
}
const out = (x: any, id: string) => x.res?.results?.[id]?.data;
(globalThis as any).__sleepScale = 1;
{ const x = await run([trig, act("a", 80), act("b", 5), unir("j"), act("n", 5, { x: "{{@j:J.inputs.a.v}}", y: "{{@j:J.inputs.b.v}}" })], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && x.count("n") === 1, "U1 wait-all: downstream runs once"); ok(x.before("done:a", "start:n") && x.before("done:b", "start:n"), "U1 downstream starts after BOTH branches"); ok(x.seen.n?.x === "A" && x.seen.n?.y === "B", `U1 unified output carries both inputs (${x.seen.n?.x}|${x.seen.n?.y})`); }
{ const x = await run([trig, act("a", 300), act("b", 5), unir("j", { joinMode: "timeout", timeoutSeconds: 0.05, onTimeout: "continue" }), act("n", 5, { y: "{{@j:J.inputs.b.v}}" })], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && x.count("n") === 1, "U2 onTimeout=continue: continues with partial inputs"); ok(x.before("start:n", "done:a"), "U2 downstream starts before the slow branch finishes"); ok(x.seen.n?.y === "B", "U2 partial output has the finished input");
  await sleep(350); ok(x.count("n") === 1, "U2 late branch does not re-run the join"); }
{ const x = await run([trig, act("a", 300), act("b", 5), unir("j", { joinMode: "timeout", timeoutSeconds: 0.05, onTimeout: "fail" }), act("n")], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && !x.ran("n") && x.res?.success === false, "U3 onTimeout=fail: join fails, downstream does not run"); await sleep(350); }
{ const x = await run([trig, act("a", 300), act("b", 5), unir("j", { joinMode: "timeout", timeoutSeconds: 0.05 }), act("n")], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && !x.ran("n") && x.res?.success === false, "U3b onTimeout not set: default is STOP (join fails, downstream does not run)"); ok(x.ran("a"), "U3b the started slow branch is not cancelled"); await sleep(350); ok(x.ev.includes("done:a"), "U3b slow branch ran to completion (no cancel/rollback)"); }
{ const x = await run([trig, act("a", 20), act("b", 5), unir("j", { joinMode: "timeout", timeoutSeconds: 5 }), act("n")], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && x.count("n") === 1 && x.before("done:a", "start:n"), "U4 timeout mode, all arrive early: does not wait for the deadline"); }
{ const x = await run([trig, act("a", 5), act("b", 30), unir("j"), act("n")], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j"), e("j", "n")], ["a"]);
  ok(x.res !== "HANG" && !x.ran("n") && x.res?.success === false, "U5 failed input (default policy): join fails, downstream does not run"); }
{ const x = await run([trig, act("a", 5), act("b", 30), unir("j", { onParentFailure: "continue" }), act("n")], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j"), e("j", "n")], ["a"]);
  ok(x.res !== "HANG" && x.count("n") === 1, "U6 onParentFailure=continue: join runs with the surviving input"); }
{ const x = await run([trig, cond("c", false), act("s"), act("b", 30), unir("j"), act("n")], [e("t", "c"), e("c", "s"), e("s", "j"), e("t", "b"), e("b", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && x.count("n") === 1 && x.res?.success !== false, "U7 branch skipped by a Condition does not block the join"); }
{ const x = await run([trig, cond("c", false), act("s"), unir("j"), act("n")], [e("t", "c"), e("c", "s"), e("s", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && !x.ran("n"), "U8 every input skipped: join and downstream do not run"); }
{ const x = await run([trig, act("a", 5), act("b", 40), act("j")], [e("t", "a"), e("t", "b"), e("a", "j"), e("b", "j")]);
  ok(x.res !== "HANG" && x.count("j") === 1 && x.before("start:j", "done:b"), "U9 a normal multi-parent step (no Unir) keeps the old behavior: runs on the first parent, once"); }
{ const x = await run([trig, act("p"), act("v1", 40), act("v2", 10), act("v3", 25), unir("u"), act("rev", 5, { m: "{{@u:U.inputs.v1.v}}|{{@u:U.inputs.v2.v}}|{{@u:U.inputs.v3.v}}" })], [e("t", "p"), e("p", "v1"), e("p", "v2"), e("p", "v3"), e("v1", "u"), e("v2", "u"), e("v3", "u"), e("u", "rev")]);
  ok(x.res !== "HANG" && x.count("rev") === 1 && x.seen.rev?.m === "V1|V2|V3", `U10 three videos then one review (${x.seen.rev?.m})`); ok(x.before("start:v1", "done:v2") && x.before("start:v3", "done:v1"), "U10 branches really overlap"); }
{ const x = await run([trig, act("a"), unir("j"), act("n")], [e("t", "a"), e("a", "j"), e("j", "n")]);
  ok(x.res !== "HANG" && x.count("n") === 1, "U11 Unir with a single input just passes through"); }
{ const x = await run([trig, act("a", 10), act("b", 10), unir("j1"), act("c", 40), unir("j2"), act("n")], [e("t", "a"), e("t", "b"), e("t", "c"), e("a", "j1"), e("b", "j1"), e("j1", "j2"), e("c", "j2"), e("j2", "n")]);
  ok(x.res !== "HANG" && x.count("n") === 1 && x.before("done:c", "start:n"), "U12 nested Unir"); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
