import jsonata from "jsonata";
import { readFileSync } from "node:fs";
// Gold offline check for C-09: find the reconciling Fórmula (one whose input
// binds two list variables), bind those variables to the fixture arrays in
// both orders, and verify the output splits into [pay_3] and [ord_7].
const wf = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fx = JSON.parse(readFileSync("evals/semantic/fixtures/c09-reconciliation.json", "utf8"));
const payments = fx.sources["stripe/list-payments"].payments;
const orders = fx.sources["tiendanube/search-orders"].orders;
const formulas = wf.nodes.filter(n => n.data.config?.actionType === "Fórmula" && n.data.config?.input);
let found = false;
for (const f of formulas) {
  let keys;
  try { keys = Object.keys(JSON.parse(f.data.config.input.replaceAll(/\{\{[^}]*\}\}/g, 'null'))); } catch { continue; }
  if (keys.length !== 2) continue;
  for (const bind of [{ [keys[0]]: payments, [keys[1]]: orders }, { [keys[0]]: orders, [keys[1]]: payments }]) {
    let r;
    try { r = await jsonata(f.data.config.expression).evaluate(bind); } catch { continue; }
    const rk = r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r) : [];
    if (rk.length !== 2) continue;
    const a = [r?.[rk[0]]].flat().filter(Boolean).map(x => x?.id);
    const b = [r?.[rk[1]]].flat().filter(Boolean).map(x => x?.id);
    console.log(`node=${f.id} keys:`, JSON.stringify(rk), "A ids:", JSON.stringify(a), "B ids:", JSON.stringify(b));
    if ((a.join() === "pay_3" && b.join() === "ord_7") || (a.join() === "ord_7" && b.join() === "pay_3")) {
      console.log("expected: A=[pay_3] B=[ord_7]\nEXPRESSION CORRECT");
      found = true; break;
    }
  }
  if (found) break;
}
if (!found) console.log("expected: A=[pay_3] B=[ord_7]\nEXPRESSION WRONG");
