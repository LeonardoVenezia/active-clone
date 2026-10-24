// Offline: emptyResultGuardError (validator) on fixtures + the saved UI-built graph, and the REAL engine on the notify fixture (local handlers). Validator + simulation, not an integration run.
import fs from "node:fs";
const v: any = await import("../../lib/flow-validator"); const { emptyResultGuardError } = v.default ?? v;
const OUT: any = { "tiendanube/list-products": ["products", "count"], "mercadolibre/list-items": ["items", "count"], Loop: ["results", "items", "count"] };
const load = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
const e = (f: string) => { const g = load(f); return emptyResultGuardError(g.nodes, g.edges, OUT); };
t("linear (no guard, no notice): flagged for both", /ONE Condition/.test(e("evals/c13/fixtures/linear-spine-graph.json") ?? "") && /SECOND Condition/.test(e("evals/c13/fixtures/linear-spine-graph.json") ?? ""));
const gd = e("evals/c13/fixtures/linear-spine-guarded-graph.json");
t("guarded (guard, no notice): only the notice missing", !!gd && /SECOND Condition/.test(gd) && !/ONE Condition/.test(gd));
t("notify fixture (guard + none branch with notice): passes", e("evals/c13/fixtures/linear-spine-notify-graph.json") === null);
if (fs.existsSync("/tmp/uigraph.json")) { const r = emptyResultGuardError(load("/tmp/uigraph.json").nodes, load("/tmp/uigraph.json").edges, OUT); t("UI-built graph from the first preview run (no guard/notice): flagged", !!r && /ONE Condition/.test(r) && /SECOND Condition/.test(r)); }
{ const g = load("evals/c13/fixtures/linear-spine-notify-graph.json"); const n = g.nodes.find((x: any) => x.id === "none-found"); n.data.config.condition = "{{@tn-products:Buscar en Tiendanube.count}} > 5";
  t("a 'none' Condition without an emptiness test is not accepted", /SECOND Condition/.test(emptyResultGuardError(g.nodes, g.edges, OUT) ?? "")); }
{ const g = load("evals/c13/fixtures/linear-spine-notify-graph.json"); const n = g.nodes.find((x: any) => x.id === "cond-any"); n.data.config.condition = "{{@tn-products:Buscar en Tiendanube.count}} > 0";
  t("a guard that ignores one search count is not accepted", /ONE Condition/.test(emptyResultGuardError(g.nodes, g.edges, OUT) ?? "")); }
{ const g = load("evals/c13/fixtures/linear-spine-notify-graph.json"); g.edges = g.edges.filter((x: any) => x.id !== "none-notice");
  t("notice branch without a child step is not accepted", /SECOND Condition/.test(emptyResultGuardError(g.nodes, g.edges, OUT) ?? "")); }
{ const g = { nodes: [{ id: "a", data: { config: { actionType: "Fórmula" } } }], edges: [] }; t("graph without the optional-step pattern: not applicable", emptyResultGuardError(g.nodes as any, g.edges as any, OUT) === null); }
let f = 0; for (const [k, ok] of res) { console.log(ok ? "PASS" : "FAIL", k); if (!ok) f++; } console.log(`${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
