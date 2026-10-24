// Offline: Manual trigger run-time input. Pure helpers, validator, ref-contract, and the engine's trigger-data merge + ref resolution. No model, no network.
import { readFileSync } from "node:fs";
const M: any = await import("../../lib/manual-input"); const m = M.default ?? M;
const F: any = await import("../../lib/field-path"); const fp = F.default ?? F;
const A: any = await import("../../lib/agent/ref-contract"); const { analyzeRefs } = A.default ?? A;
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
const cfg = { triggerType: "Manual", inputFields: [{ key: "producto", label: "Producto", required: true }, { key: "nota", label: "Nota", required: false }] };
t("parse keeps valid fields", m.parseInputFields(cfg).length === 2);
t("bad key rejected", m.manualInputProblems({ triggerType: "Manual", inputFields: [{ key: "1 x", label: "a" }] }).length > 0);
t("reserved key rejected", m.manualInputProblems({ triggerType: "Manual", inputFields: [{ key: "timestamp", label: "a" }] }).length > 0);
t("too many rejected", m.manualInputProblems({ triggerType: "Manual", inputFields: Array.from({ length: 9 }, (_, i) => ({ key: "k" + i, label: "a" })) }).length > 0);
for (const k of ["constructor", "prototype", "toString", "hasOwnProperty", "__proto__"]) t("key " + k + " rejected", m.manualInputProblems({ triggerType: "Manual", inputFields: [{ key: k, label: "a" }] }).length > 0 && m.parseInputFields({ inputFields: [{ key: k, label: "a" }] }).length === 0);
const f = m.parseInputFields(cfg);
{ const polluted = JSON.parse('{"__proto__":{"x":"1"},"producto":"ok"}'); const r2 = m.prepareInput(f, polluted); t("__proto__ in body ignored", r2.input.producto === "ok" && ({} as any).x === undefined && Object.keys(r2.input).join() === "producto"); }
{ const r3 = m.prepareInput(m.parseInputFields({ inputFields: [{ key: "a", label: "A" }] }), Object.create({ a: "inherited" })); t("inherited props not read", r3.missing.length === 1); }
t("array/object values rejected", m.prepareInput(f, { producto: ["x"] }).missing.length === 1 && m.prepareInput(f, { producto: { a: 1 } }).missing.length === 1);
let p = m.prepareInput(f, { producto: " 123 ", extra: "x" }); t("trims, drops undeclared", p.input.producto === "123" && !("extra" in p.input) && p.missing.length === 0);
p = m.prepareInput(f, {}); t("required missing reported", p.missing.length === 1);
p = m.prepareInput(f, { producto: "x".repeat(900) }); t("over-limit value is flagged, not truncated", p.tooLong.length === 1 && !("producto" in p.input));
p = m.prepareInput(f, { producto: "x".repeat(500) }); t("exactly 500 accepted intact", p.tooLong.length === 0 && p.input.producto.length === 500);
t("route rejects over-limit with 400", /tooLongInput/.test(readFileSync("app/api/workflow/[workflowId]/execute/route.ts", "utf8")));
// engine merge (same expression as workflow-executor) + ref resolution
const triggerData = { ...{ triggered: true, timestamp: 1 }, ...m.prepareInput(f, { producto: "ABC" }).input };
t("engine data resolves ref", fp.resolveFieldValue(triggerData, "producto") === "ABC");
// validator
const node = (id: string, config: any, type = "action") => ({ id, data: { type, config } });
const trig = node("t1", cfg, "trigger");
const ok = [trig, node("a", { x: "{{@t1:Manual.producto}}" })];
t("declared ref passes", m.manualInputError(ok) === null);
const bad = [trig, node("a", { x: "{{@t1:Manual.otro}}" })];
t("undeclared ref flagged", (m.manualInputError(bad) ?? "").includes("otro"));
t("triggered ref passes", m.manualInputError([trig, node("a", { x: "{{@t1:Manual.timestamp}}" })]) === null);
t("malformed fields flagged", m.manualInputError([node("t1", { triggerType: "Manual", inputFields: "x" }, "trigger")]) !== null);
t("flow without inputFields unchanged", m.manualInputError([node("t1", { triggerType: "Manual" }, "trigger"), node("a", { x: "plain" })]) === null);
// ref-contract
const nodes = (k: string) => [{ id: "t1", label: "Manual", config: cfg }, { id: "a", label: "A", actionType: "x/y", config: { v: `{{@t1:Manual.${k}}}` } }];
const cls = (k: string) => analyzeRefs(nodes(k), () => undefined).map((x: any) => x.cls)[0];
t("contract: declared input ok", cls("producto") === "ok"); t("contract: undeclared still unfillable", cls("zzz") === "unfillable");
const route = readFileSync("app/api/workflow/[workflowId]/execute/route.ts", "utf8");
t("route returns 400 on missing", /missingInput/.test(route) && /400/.test(route));
res.forEach(([n, ok]) => console.log(ok ? "PASS" : "FAIL", n)); console.log(`${res.filter((r) => r[1]).length}/${res.length}`); process.exit(res.every((r) => r[1]) ? 0 : 1);
