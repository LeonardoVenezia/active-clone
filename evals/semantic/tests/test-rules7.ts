// formulaExpressionError join-field existence: TP en re15 (join inventado),
// sin FP en re12/re14 (template correcto) ni re13c12 (inputs no-lista).
import { readFileSync } from "node:fs";
import { formulaExpressionError } from "../../../lib/flow-validator";

const ITEM_FIELDS: Record<string, Record<string, string[]>> = {
  "stripe/list-payments": { payments: ["id", "status", "amount", "currency", "customerId", "created"] },
  "tiendanube/search-orders": { orders: ["id", "number", "status", "paymentStatus", "shippingStatus", "total", "currency", "customerEmail", "customerName", "createdAt"] },
};
const load = (f: string) => JSON.parse(readFileSync(`evals/semantic/snapshots/${f}`, "utf8"));
let bad = 0;
{
  const err = formulaExpressionError(load("re15-final-s6y5qvj5gcaono3pclokx.json").nodes, ITEM_FIELDS);
  if (!err || !err.includes("only have")) { console.log("MISS join-field en re15:", err); bad++; }
}
for (const f of ["re12-final-q482692dkhdpdjryb7euu.json", "re14-final-8ytao6745aqtkkwphj75f.json", "re13c12-uwlmkk76pzop0xn3nt1n1.json"]) {
  const err = formulaExpressionError(load(f).nodes, ITEM_FIELDS);
  if (err && err.includes("only have")) { console.log("FP join-field", f, ":", err.slice(0, 140)); bad++; }
}
if (bad) { console.log(`${bad} problems`); process.exit(1); }
console.log("ALL-RULES7 OK");
