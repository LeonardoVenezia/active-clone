// @ts-nocheck
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { if (/^server-only$/.test(q)) return r.resolve("../../evals/semantic/stubs/server-only.ts"); return o.call(this, q, ...a); };
const m: any = await import("../../lib/flow-validator"); const v = m.default ?? m;
const n = (id: string, cfg: any = {}, type = "action") => ({ id, type, position: { x: 0, y: 0 }, data: { type, label: id, config: cfg } });
const e = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
let f = 0; const ok = (c: boolean, msg: string) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"} ${msg}`); };
const T = n("t", { triggerType: "Manual" }, "trigger");
const base = [T, n("a", { actionType: "Delay", durationSeconds: 1 }), n("b", { actionType: "Delay", durationSeconds: 1 })];
const ed = [e("t", "a"), e("t", "b")];
const reader = (id: string, ref: string) => n(id, { actionType: "Fórmula", input: `{"x":"{{@${ref}:X.v}}"}`, expression: "x" });
// plain join reading a sibling: race flagged
ok(!!v.refOrderRaceError([...base, reader("j", "a")], [...ed, e("a", "j"), e("b", "j")]), "plain 2-parent step reading one parent is still flagged as a race");
// via Unir: not flagged
ok(v.refOrderRaceError([...base, n("u", { actionType: "Unir" }), reader("j", "a")], [...ed, e("a", "u"), e("b", "u"), e("u", "j")]) === null, "step after a Unir reading a branch is ordered");
const U = n("u", { actionType: "Unir" });
const tw = (nodes: any[], edges: any[]) => v.validateFlow(nodes, edges, {}, new Set(["Delay", "Unir", "Fórmula"]));
const good = tw([...base, U, reader("j", "u")], [...ed, e("a", "u"), e("b", "u"), e("u", "j")]);
console.log(good);
ok(!good.some((x: string) => /Unir/.test(x)), "valid Unir has no Unir error");
ok(tw([...base, n("u", { actionType: "Unir", joinMode: "timeout" })], [...ed, e("a", "u"), e("b", "u")]).some((x: string) => /timeoutSeconds/.test(x)), "timeout mode without seconds is rejected");
ok(tw([...base, n("u", { actionType: "Unir", joinMode: "timeout", timeoutSeconds: 0 })], [...ed, e("a", "u"), e("b", "u")]).some((x: string) => /timeoutSeconds/.test(x)) === true, "timeoutSeconds 0 rejected");
ok(tw([...base, n("u", { actionType: "Unir", joinMode: "timeout", timeoutSeconds: "abc" })], [...ed, e("a", "u"), e("b", "u")]).some((x: string) => /timeoutSeconds/.test(x)) === true, "timeoutSeconds text rejected");
ok(tw([...base, n("u", { actionType: "Unir", joinMode: "timeout", timeoutSeconds: 0.5 })], [...ed, e("a", "u"), e("b", "u")]).some((x: string) => /timeoutSeconds/.test(x)) === true, "timeoutSeconds 0.5 rejected");
ok(tw([...base, n("u", { actionType: "Unir", joinMode: "timeout", timeoutSeconds: 86401 })], [...ed, e("a", "u"), e("b", "u")]).some((x: string) => /timeoutSeconds/.test(x)) === true, "timeoutSeconds 86401 rejected");
ok(tw([...base, n("u", { actionType: "Unir", joinMode: "timeout", timeoutSeconds: 1 })], [...ed, e("a", "u"), e("b", "u")]).some((x: string) => /timeoutSeconds/.test(x)) === false, "timeoutSeconds 1 accepted");
ok(tw([...base, n("u", { actionType: "Unir", joinMode: "timeout", timeoutSeconds: 86400 })], [...ed, e("a", "u"), e("b", "u")]).some((x: string) => /timeoutSeconds/.test(x)) === false, "timeoutSeconds 86400 accepted");
ok(tw([...base, U], [...ed, e("a", "u")]).some((x: string) => /at least 2/.test(x)), "Unir with one input is rejected");
const res = (nodes: any[], edges: any[]) => { try { return v.validateFlow(nodes, edges, {}) } catch (x) { return { err: String(x) } } };
console.log(JSON.stringify(Object.keys(v)).slice(0, 300));
console.log(f ? `${f} FAILED` : "ALL PASS"); process.exit(f ? 1 : 0);
