// Offline: exact contract repair (lib/agent/contract-repair.ts) + data-order race validator (refOrderRaceError), on the saved prod QA graph and the repaired fixtures. Validator-level, no engine run.
import fs from "node:fs";
const v: any = await import("../../lib/flow-validator"); const { validateFlow, refOrderRaceError } = v.default ?? v;
const rp: any = await import("../../lib/agent/contract-repair"); const { repairOutputContracts } = rp.default ?? rp;
const OUT = { "Fórmula": ["result"], Loop: ["results", "items", "failed", "count", "completed", "failedCount"], "ai-gateway/generate-text": ["text", "object"], "fal/generate-video": ["videoUrl"], "fal/generate-image": ["imageUrl"], Approval: ["approved"], "tiendanube/list-products": ["products", "count"], "mercadolibre/list-items": ["items", "count"], "tiendanube/get-product": ["name", "description", "id"], "mercadolibre/get-item": ["title", "description", "id"], "perplexity/research": ["report"] };
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
const load = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const prod = () => load("/tmp/prodgraph.json");
const has = (errs: string[], re: RegExp) => errs.some((e) => re.test(e));
// 1) Loop source repair on the prod graph (Fórmula returns the list itself)
{ const g = prod(); const n = repairOutputContracts(g.nodes); const src = g.nodes.find((x: any) => x.id === "loop-guiones").data.config.source;
  t("prod graph: Loop source .result.angulos repaired to .result (exact)", src.endsWith(".result}}") && n >= 1);
  t("prod graph: repair is idempotent", repairOutputContracts(g.nodes) === 0); }
// 2) AI object refs repair when the schema is a VALID array; text steps untouched
{ const g = prod(); const ws = g.nodes.find((x: any) => x.id === "loop-guiones").data.config.steps[0].config;
  const before = JSON.stringify(g.nodes.find((x: any) => x.id === "loop-videos").data.config);
  const errsBefore = validateFlow(g.nodes, g.edges, OUT as any) as string[];
  t("before repair (invalid aiSchema): flat reads flagged", has(errsBefore, /steps\.write_script/) || has(errsBefore, /does not exist/));
  ws.aiSchema = JSON.stringify(["titulo", "gancho", "guion", "textoEnPantalla", "visualPrompt"].map((name) => ({ name, type: "string" })));
  const n = repairOutputContracts(g.nodes);
  const lv = JSON.stringify(g.nodes.find((x: any) => x.id === "loop-videos").data.config); const tg = g.nodes.find((x: any) => x.id === "texto-guiones").data.config.expression;
  t(`valid schema: flat steps.write_script.<f> rewritten to .object.<f> in item refs (${n} refs)`, lv.includes("steps.write_script.object.visualPrompt") && !/steps\.write_script\.visualPrompt/.test(lv));
  t("valid schema: Fórmula expression steps.write_script.<f> rewritten", tg.includes("steps.write_script.object.titulo") && !/steps\.write_script\.titulo/.test(tg));
  const errs = validateFlow(g.nodes, g.edges, OUT as any) as string[];
  t("after repair + valid schema: no contract errors left (aiSchema/object/source)", !has(errs, /aiSchema|returns only|does not exist|source points/));
  t("repair never touches unrelated text", before !== lv && lv.includes("portrait_16_9")); }
// 3) text-format AI: nothing is rewritten (no object exists)
{ const g = prod(); const ws = g.nodes.find((x: any) => x.id === "loop-guiones").data.config.steps[0].config; ws.aiFormat = "text"; delete ws.aiSchema; const b = JSON.stringify(g.nodes); repairOutputContracts(g.nodes); const a = JSON.stringify(g.nodes);
  t("text-format AI: only the Loop source repair applies, no .object invented", !a.includes("write_script.object")); void b; }
// 4) data-order race
{ const g = prod(); const e = refOrderRaceError(g.nodes, g.edges);
  t("prod graph: race flagged (research reads tn-products/ml-items; approve reads texto-guiones with a parallel parent)", !!e && /research|approve/.test(e));
  for (const f of ["linear-spine-graph", "linear-spine-guarded-graph"]) { const x = load(`evals/c13/fixtures/${f}.json`); t(`${f}: no race`, refOrderRaceError(x.nodes, x.edges) === null); } }
{ // approve with the parallel edge removed is ordered
  const g = prod(); g.edges = g.edges.filter((x: any) => !(x.source === "loop-guiones" && x.target === "approve")); const e = refOrderRaceError(g.nodes, g.edges);
  t("approve race gone when the parallel loop-guiones->approve edge is removed (research race remains)", !!e && !/"approve"/.test(e)); }
{ // alternative-branch ref (downstream of a Condition) is NOT flagged: analysis only
  const mk = (id: string, cfg: any) => ({ id, type: "action", position: { x: 0, y: 0 }, data: { type: "action", label: id, config: cfg } });
  const nodes = [mk("t", { actionType: "Manual" }), mk("c", { actionType: "Condition", condition: "1 > 0" }), mk("a", { actionType: "Fórmula", input: "{}", expression: "1" }), mk("b", { actionType: "Fórmula", input: "{}", expression: "2" }), mk("y", { actionType: "ai-gateway/generate-text", aiPrompt: "{{@a:a.result}}" })];
  const edges = [["t", "c"], ["t", "b"], ["c", "a"], ["a", "y"], ["b", "y"]].map(([s, d]) => ({ id: s + d, source: s, target: d }));
  t("ref to a Condition-downstream node is not flagged (limit: analysis only)", refOrderRaceError(nodes as any, edges as any) === null); }
let f = 0; for (const [k, ok] of res) { console.log(ok ? "PASS" : "FAIL", k); if (!ok) f++; } console.log(`${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
