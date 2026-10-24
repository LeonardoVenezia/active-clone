// Offline, report-only. Unknown-config-key analysis + sanitized repair log. Fixtures are RECONSTRUCTED (no raw model calls were stored).
import Module from "node:module"; import { createRequire } from "node:module"; import { readFileSync, existsSync } from "node:fs";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
const A: any = await import("../../lib/agent/ref-contract"); const { analyzeConfigKeys } = A.default ?? A;
const L: any = await import("../../lib/agent/repair-log"); const { recordRepair } = L.default ?? L;
const B: any = await import("../../lib/agent/build-core"); const { fixFormulaRefsIn, shadowApply } = B.default ?? B;
await import("../../plugins"); const R: any = await import("../../plugins/registry"); const reg = R.default ?? R;
const keys = new Map<string, string[]>(); for (const a of reg.getAllActions()) keys.set(a.id, reg.flattenConfigFields(a.configFields ?? []).map((f: any) => f.key));
const declaredKeys = (t: string) => keys.get(t);
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")).nodes.map((n: any) => ({ id: n.id, label: n.label, actionType: n.a, config: { ...(["Manual", "Webhook", "Schedule"].includes(n.a) ? { triggerType: n.a } : { actionType: n.a }), ...(n.cfg ?? {}) } }));
const home = process.env.HOME;
for (const f of ["exact-case-609ff7c-config", "exact-case-d3d7d06-ds-config"]) { const p = `${home}/evidence/${f}.json`; if (!existsSync(p)) continue; const fs = analyzeConfigKeys(load(p), declaredKeys); console.log(f, "unknown keys:", fs.length ? fs.map((x: any) => `${x.where}.${x.key}`).join(", ") : "none"); }
const ds = existsSync(`${home}/evidence/exact-case-d3d7d06-ds-config.json`) ? analyzeConfigKeys(load(`${home}/evidence/exact-case-d3d7d06-ds-config.json`), declaredKeys) : [];
t("saved DS config: Manual inputFields flagged", ds.some((x: any) => x.key === "inputFields"));
let fs: any[] = analyzeConfigKeys([{ id: "m", config: { triggerType: "Manual" } }], declaredKeys); t("Manual with no extras: clean", fs.length === 0);
fs = analyzeConfigKeys([{ id: "s", config: { triggerType: "Schedule", scheduleCron: "0 9 * * *", scheduleTimezone: "x" } }], declaredKeys); t("Schedule known keys: clean", fs.length === 0);
fs = analyzeConfigKeys([{ id: "g", config: { actionType: "tiendanube/get-product", productId: "1", bogus: 1 } }], declaredKeys); t("plugin action: declared key ok, bogus flagged", fs.length === 1 && fs[0].key === "bogus");
fs = analyzeConfigKeys([{ id: "c", config: { actionType: "Loop", source: "x", whatever: 1 } }], declaredKeys); t("system action types not judged", fs.length === 0);
// repair log: reconstructed shadows
const mk = (cfgs: any[]) => ({ nodes: cfgs.map((c, i) => ({ id: c.id, type: "action", data: { label: c.id, type: "action", config: c.config } })), edges: [] as any[] });
let sh: any = mk([{ id: "f", config: { actionType: "Fórmula", expression: "[1]" } }, { id: "x", config: { actionType: "ai-gateway/generate-text", aiPrompt: "{{@f:F.items}}", apiKey: "SECRET-VALUE-123" } }]);
let rr = recordRepair("fixFormulaRefsIn", sh.nodes, () => fixFormulaRefsIn(sh));
t("repair log captures the .result wrapper rewrite", rr.entries.some((e: any) => e.nodeId === "x" && e.path === "aiPrompt" && e.before.includes("F.items") && e.after.includes("F.result.items")));
t("repair log never contains the secret value", !JSON.stringify(rr.entries).includes("SECRET-VALUE-123"));
sh = mk([{ id: "f", config: { actionType: "Fórmula" } }, { id: "x", config: { actionType: "Loop", source: "{{@f:F.result}}" } }]);
rr = recordRepair("fixFormulaRefsIn", sh.nodes, () => fixFormulaRefsIn(sh)); t("no-op repair logs nothing", rr.entries.length === 0);
const sh2: any = { nodes: [], edges: [] };
const loopNode: any = { id: "l", type: "action", data: { label: "L", type: "action", config: { actionType: "Loop", source: "s", steps: [{ id: "a", actionType: "ai-gateway/generate-text", aiPrompt: "p", token: "TOK-999" }] } } };
const probe = [{ id: "l", data: loopNode.data }];
rr = recordRepair("shadowApply.addNode(loop inner fold)", probe, () => shadowApply({ op: "addNode", node: loopNode }, sh2));
t("Loop inner-step fold is logged, steps[0].config.aiPrompt appears", rr.entries.some((e: any) => e.path === "steps[0].config.aiPrompt"));
t("Loop inner fold: secret-like key redacted", !JSON.stringify(rr.entries).includes("TOK-999") && rr.entries.some((e: any) => e.after === "[redacted]"));
const longv = "x".repeat(500); sh = mk([{ id: "f", config: { actionType: "Fórmula" } }, { id: "x", config: { actionType: "a/b", p: `{{@f:F.q}} ${longv}` } }]);
rr = recordRepair("fixFormulaRefsIn", sh.nodes, () => fixFormulaRefsIn(sh)); t("long values truncated", rr.entries.every((e: any) => e.before.length < 140 && e.after.length < 140) && rr.entries.length === 1);
let f = 0; console.log(); for (const [k, ok] of res) { console.log(ok ? "PASS" : "FAIL", k); if (!ok) f++; } process.exit(f ? 1 : 0);
