// Offline: validator results must not depend on call order. TEMPLATE_RE (flow-validator.ts) is a shared /g regex; a successful
// .test() in unwiredReportStepError left lastIndex advanced, so the next validateFlow rejected a correct Loop source (and matchAll
// started from that offset). Fixture: minimal Loop over search-orders.orders feeding a Slack report that references data.
import fs from "node:fs";
const v: any = await import("../../lib/flow-validator"); const { validateFlow, unwiredReportStepError } = v.default ?? v;
const load = () => JSON.parse(fs.readFileSync("evals/c13/fixtures/loop-source-order-graph.json", "utf8"));
const res: [string, boolean, string][] = []; const t = (n: string, ok: boolean, d = "") => res.push([n, ok, d]);
const SOURCE_ERR = /Loop node "loop" .* needs "source"/;
const V = (g: any) => validateFlow(g.nodes, g.edges) as string[];
const U = (g: any) => unwiredReportStepError(g.nodes, g.edges) as string | null;
const srcErr = (errs: string[]) => errs.filter((e) => SOURCE_ERR.test(e));

{ const g = load();
  t("validateFlow alone: a correct Loop source has no source error", srcErr(V(g)).length === 0, JSON.stringify(srcErr(V(g))));
  t("the fixture's report step references data, so unwiredReportStepError passes (and its regex test succeeds)", U(g) === null);
  const g2 = load(); U(g2); const after = V(g2);
  t("unwiredReportStepError THEN validateFlow: still no source error (was a false error before the fix)", srcErr(after).length === 0, JSON.stringify(srcErr(after))); }
{ const g = load(); const base = JSON.stringify(V(g)); const baseU = U(load());
  const orders: [string, string[]][] = [["V,V,V", ["V", "V", "V"]], ["U,V,V", ["U", "V", "V"]], ["V,U,V,U,V", ["V", "U", "V", "U", "V"]], ["U,U,V,U,V", ["U", "U", "V", "U", "V"]]];
  for (const [name, seq] of orders) {
    const g1 = load(); const outV: string[] = []; const outU: (string | null)[] = [];
    for (const s of seq) { if (s === "V") outV.push(JSON.stringify(V(g1))); else outU.push(U(g1)); }
    t(`order ${name}: every validateFlow returns the identical full error list, every unwiredReportStepError the identical result`, outV.every((x) => x === base) && outU.every((x) => x === baseU), JSON.stringify({ base, outV }).slice(0, 600));
  } }
// Same leak, other direction: matchAll(TEMPLATE_RE) inherits lastIndex, so a bad reference early in a string was skipped (false negative).
{ const n = (id: string, config: any, type = "action") => ({ id, type, data: { label: id, type, config } });
  const bad = { nodes: [n("t", { triggerType: "Manual" }, "trigger"), n("s", { actionType: "slack/send-message", slackChannel: "#v", slackMessage: "{{@fantasma:X.text}}" })], edges: [{ source: "t", target: "s" }] };
  const ghost = () => V(bad).filter((e) => e.includes("fantasma")).length;
  const fresh = ghost(); U(load()); const after = ghost();
  t("reference to a missing node is flagged the same before and after unwiredReportStepError (graph without Loop)", fresh > 0 && after === fresh, JSON.stringify({ fresh, after })); }
// Negative: invalid sources by the CURRENT rule (no {{@id:Label.field}} template at all) stay flagged, in any order.
for (const [name, source] of [["missing", undefined], ["plain text", "pedidos de ayer"], ["number", 42], ["empty", ""], ["template without @", "{{buscar-pedidos.orders}}"]] as [string, unknown][]) {
  for (const first of ["V", "U"]) {
    const g = load(); const loop = g.nodes.find((n: any) => n.id === "loop"); if (source === undefined) delete loop.data.config.source; else loop.data.config.source = source;
    if (first === "U") U(g);
    t(`invalid source (${name}), ${first === "U" ? "after unwiredReportStepError" : "fresh"}: flagged`, srcErr(V(g)).length === 1);
  }
}
let f = 0; for (const [k, ok, d] of res) { console.log(ok ? "PASS" : "FAIL", k, ok ? "" : d); if (!ok) f++; } console.log(`${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
