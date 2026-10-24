// Offline: output-contract validators (pure). Detect the ORIGINAL failures of the prod DS graph. Validator-level only: no engine run, no model, no network.
const v: any = await import("../../lib/flow-validator"); const { validateFlow } = v.default ?? v;
const oc: any = await import("../../lib/agent/output-contract");
const fs = await import("node:fs");
const OUT = { "Fórmula": ["result"], Loop: ["results", "items", "failed", "count", "completed", "failedCount"], "ai-gateway/generate-text": ["text", "object"], "fal/generate-video": ["videoUrl"], Approval: ["approved"] };
const res: [string, boolean, string?][] = []; const t = (n: string, ok: boolean, d?: string) => res.push([n, ok, d]);
const N = (id: string, label: string, config: any, type = "action") => ({ id, type, position: { x: 0, y: 0 }, data: { type, label, config } });
const E = (a: string, b: string) => ({ id: `${a}-${b}`, source: a, target: b });
const trig = N("t", "T", { triggerType: "Manual" }, "trigger");
const run = (nodes: any[], edges: any[]) => validateFlow([trig, ...nodes] as any, edges as any, OUT as any) as string[];
const has = (errs: string[], re: RegExp) => errs.some((e) => re.test(e));
// ---- aiSchema shape
const ai = (cfg: any) => run([N("a", "Guion", { actionType: "ai-gateway/generate-text", aiPrompt: "x", ...cfg })], [E("t", "a")]);
t("aiSchema JSON-Schema object flagged", has(ai({ aiFormat: "object", aiSchema: JSON.stringify({ type: "object", properties: { x: { type: "string" } } }) }), /ARRAY/));
t("aiSchema array with type array flagged (dropped type)", has(ai({ aiFormat: "object", aiSchema: JSON.stringify([{ name: "x", type: "array" }]) }), /supported types/));
t("aiSchema valid array not flagged", !has(ai({ aiFormat: "object", aiSchema: JSON.stringify([{ name: "x", type: "string" }]) }), /aiSchema/));
t("aiSchema absent with object still flagged (existing rule)", has(ai({ aiFormat: "object" }), /no aiSchema/));
t("text format: no aiSchema complaint", !has(ai({ aiFormat: "text" }), /aiSchema/));
// ---- top-level refs to an AI step
const aiNode = (cfg: any) => N("a", "Guion", { actionType: "ai-gateway/generate-text", aiPrompt: "x", ...cfg });
const reader = (path: string) => N("r", "R", { actionType: "ai-gateway/generate-text", aiPrompt: `{{@a:Guion.${path}}}` });
const sch = JSON.stringify([{ name: "titulo", type: "string" }]);
t("ref .object on text-format AI flagged", has(run([aiNode({ aiFormat: "text" }), reader("object.titulo")], [E("t", "a"), E("a", "r")]), /returns only "\.text"/));
t("ref .text on object-format AI flagged", has(run([aiNode({ aiFormat: "object", aiSchema: sch }), reader("text")], [E("t", "a"), E("a", "r")]), /returns "\.object/));
t("ref .object.titulo on valid object AI ok", !has(run([aiNode({ aiFormat: "object", aiSchema: sch }), reader("object.titulo")], [E("t", "a"), E("a", "r")]), /Guion|object/));
t("ref .object.nope flagged", has(run([aiNode({ aiFormat: "object", aiSchema: sch }), reader("object.nope")], [E("t", "a"), E("a", "r")]), /only defines: titulo/));
t("ref .text on text AI ok", !has(run([aiNode({}), reader("text")], [E("t", "a"), E("a", "r")]), /Guion/));
t("envelope .success/.error always allowed", !has(run([aiNode({}), reader("success")], [E("t", "a"), E("a", "r")]), /Guion/));
t("dynamic field on a NON-ai step with unknown action is not flagged", !has(run([N("c", "Comp", { actionType: "composio/run-tool" }), N("r", "R", { actionType: "ai-gateway/generate-text", aiPrompt: "{{@c:Comp.anything.deep}}" })], [E("t", "c"), E("c", "r")]), /anything/));
// ---- Fórmula list -> Loop source
const form = (expr: string, input = '{"a":[1,2,3]}') => N("f", "Lista", { actionType: "Fórmula", input, expression: expr });
const loop = (rest: string, steps: any[] = [{ id: "s1", actionType: "ai-gateway/generate-text", config: { aiPrompt: "{{@item:Item}}" } }]) => N("l", "Bucle", { actionType: "Loop", source: `{{@f:Lista.${rest}}}`, steps });
const lerr = (expr: string, rest: string, input?: string) => run([form(expr, input), loop(rest)], [E("t", "f"), E("f", "l")]);
t("Loop source .result.angulos when Formula returns the list itself: flagged", has(lerr("a", "result.angulos"), /does not exist/));
t("Loop source .result when Formula returns the list: ok", !has(lerr("a", "result"), /Loop "l"/));
t("Loop source .result.angulos when Formula returns {angulos:[..]}: ok", !has(lerr('{"angulos":[1,2]}', "result.angulos"), /Loop "l"/));
t("Loop source .result when Formula returns an object: flagged", has(lerr('{"angulos":[1,2]}', "result"), /not a list/));
t("non-constant Formula (JSONata function) is UNKNOWN, not flagged", !has(lerr("$map(a, function($x){$x})", "result.angulos"), /Loop "l"/));
t("templated Formula input is UNKNOWN, not flagged", !has(lerr("a", "result.angulos", '{"a": {{@t:T.x}}}'), /Loop "l"/));
t("constantFormulaResult bounded (oversize unknown)", oc.constantFormulaResult({ input: "[" + "1,".repeat(40000) + "1]", expression: "a" }).known === false);
// ---- Loop.items -> Loop / Formula over steps.<sid>.<field>
const inner = (cfg: any, type = "ai-gateway/generate-text") => N("l1", "L1", { actionType: "Loop", source: "{{@f:Lista.result}}", steps: [{ id: "write_script", actionType: type, config: { aiPrompt: "x", ...cfg } }] });
const nested = (path: string, cfg: any) => run([form("a"), inner(cfg), N("l2", "L2", { actionType: "Loop", source: "{{@l1:L1.items}}", steps: [{ id: "v", actionType: "ai-gateway/generate-text", config: { aiPrompt: `{{@item:Item.steps.write_script.${path}}}` } }] })], [E("t", "f"), E("f", "l1"), E("l1", "l2")]);
t("Item.steps.write_script.object.x on TEXT step flagged", has(nested("object.x", { aiFormat: "text" }), /returns only "\.text"/));
t("Item.steps.write_script.text on text step ok", !has(nested("text", {}), /Item\.steps/));
t("Item.steps.write_script.object.titulo on valid object ok", !has(nested("object.titulo", { aiFormat: "object", aiSchema: sch }), /Item\.steps/));
t("Item.steps.write_script.titulo (flat) on object step flagged", has(nested("titulo", { aiFormat: "object", aiSchema: sch }), /read as "\.object\.titulo"|directly/));
t("Item.steps.<unknown inner>.x flagged", has(nested("x", {}).concat(run([form("a"), inner({}), N("l2", "L2", { actionType: "Loop", source: "{{@l1:L1.items}}", steps: [{ id: "v", actionType: "ai-gateway/generate-text", config: { aiPrompt: "{{@item:Item.steps.nope.text}}" } }] })], [E("t", "f"), E("f", "l1"), E("l1", "l2")])), /no inner step "nope"/));
const fx = (expr: string, cfg: any) => run([form("a"), inner(cfg), N("fx", "Fx", { actionType: "Fórmula", input: '{"items": {{@l1:L1.items}}}', expression: expr })], [E("t", "f"), E("f", "l1"), E("l1", "fx")]);
t("Formula steps.write_script.object.x over Loop items on text step flagged", has(fx("$map(items, function($i){ $i.steps.write_script.object.x })", { aiFormat: "text" }).concat(fx("steps.write_script.object.x", { aiFormat: "text" })), /returns only "\.text"/));
t("Formula steps.write_script.text ok", !has(fx("steps.write_script.text", {}), /write_script/));
// ---- the saved prod graph (turn 2 of the QA run) must now be rejected for the original reasons
if (fs.existsSync("/tmp/prodgraph.json")) {
  const g = JSON.parse(fs.readFileSync("/tmp/prodgraph.json", "utf8"));
  const errs = validateFlow(g.nodes, g.edges, OUT as any) as string[];
  console.log("prod graph validator errors:", errs.length); for (const e of errs) console.log("  -", e.slice(0, 200));
  t("prod graph: aiSchema shape detected", has(errs, /aiSchema|ARRAY/));
  t("prod graph: Loop source Formula detected", has(errs, /Loop ".*source points to/));
}
let f = 0; for (const [k, ok, d] of res) { console.log(ok ? "PASS" : "FAIL", k, d ?? ""); if (!ok) f++; } console.log(`${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
