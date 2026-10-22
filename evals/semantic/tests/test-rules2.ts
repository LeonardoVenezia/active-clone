import "/home/sandbox/ac/plugins/index";
import { readFileSync, readdirSync } from "node:fs";
import { validateFlow, conditionExpressionError, listCrossingError, type FlowNode, type FlowEdge } from "/home/sandbox/ac/lib/flow-validator";
import { getActionOutputFields, getActionOutputItemFields } from "/home/sandbox/ac/plugins/registry";

let bad = 0;
const promptOf = (id: string) => {
  for (const l of readFileSync("/home/sandbox/ac/evals/cases.jsonl", "utf8").trim().split("\n")) {
    const c = JSON.parse(l); if (c.id === id) return c.prompt as string;
  }
  return "";
};
const load = (f: string) => JSON.parse(readFileSync("/home/sandbox/ac/evals/semantic/snapshots/" + f, "utf8"));

// conditionExpressionError: sintéticos
const condNode = (expr: string) => ({ id: "c1", type: "action", data: { label: "C", config: { actionType: "Condition", condition: expr } } });
if (!conditionExpressionError([condNode("delayed === 'delayed' || delayed === 'problem'")] as never[])) { console.log("MISS bare ident"); bad++; }
if (conditionExpressionError([condNode("{{@get-order:Get Order.status}} === 'paid'")] as never[])) { console.log("FP templated cond"); bad++; }
if (conditionExpressionError([condNode("{{@f:F.price}} * 1.21 > 100")] as never[])) { console.log("FP numeric"); bad++; }
const loopBare = { id: "l1", type: "action", data: { label: "L", config: { actionType: "Loop", source: "{{@a:A.items}}", steps: [{ id: "s1", actionType: "Condition", config: { condition: "orderResult.status === 'paid'" } }] } } };
if (!conditionExpressionError([loopBare] as never[])) { console.log("MISS inner bare ident"); bad++; }

// Sin FP sobre TODOS los snapshots reales
// fulljson-k1m4t47 usa `x contains 'y'` infijo, sintaxis inválida en runtime (TP)
const EXPECTED_COND_HIT = "fulljson-k1m4t47iuliuj6vb7pq6c.json";
for (const f of readdirSync("/home/sandbox/ac/evals/semantic/snapshots")) {
  const wf = load(f);
  const err = conditionExpressionError((wf.nodes ?? []) as FlowNode[]);
  if (f === EXPECTED_COND_HIT) {
    if (!err || !err.includes("contains")) { console.log("MISS conditionExpr esperada en fulljson-k1m4t47"); bad++; }
    continue;
  }
  if (err) { console.log(`FP conditionExpr ${f}: ${err.slice(0, 120)}`); bad++; }
}

// listCrossingError (semántica nueva aprobada): acepta Fórmula con 2 listas o Loop con lookup; flaggea lo demás
const c09 = promptOf("C-09");
if (listCrossingError(c09, load("re6-j1rq5fxs8dzeymrepge66.json").nodes as FlowNode[])) { console.log("FP listCrossing C-09b (Fórmula 2 listas)"); bad++; }
if (listCrossingError(c09, load("re5-hw0ycjusgh239zupz6mkq.json").nodes as FlowNode[])) { console.log("FP listCrossing re5-hw0y (Fórmula 2 listas)"); bad++; }
if (!listCrossingError(c09, load("re2-bizmjdooc73ers4vns2n8.json").nodes as FlowNode[])) { console.log("MISS listCrossing re2 dump loops"); bad++; }
if (listCrossingError(c09, load("re6-gazeh0hcloippncnl8srb.json").nodes as FlowNode[])) { console.log("FP listCrossing C-09a re6 (Loop con lookup)"); bad++; }

// Placeholder skip: literal provisto por el usuario
const c09b = load("re6-j1rq5fxs8dzeymrepge66.json");
const baseOpts = { actionItemFields: getActionOutputItemFields() };
const withPrompt = validateFlow(c09b.nodes as FlowNode[], c09b.edges as FlowEdge[], getActionOutputFields(), undefined, { ...baseOpts, userPrompt: c09 + " finanzas@example.com" });
if (withPrompt.some(e => e.includes("send-gmail") && e.includes("placeholder"))) { console.log("FP placeholder con literal del prompt"); bad++; }
const without = validateFlow(c09b.nodes as FlowNode[], c09b.edges as FlowEdge[], getActionOutputFields(), undefined, baseOpts);
if (!without.some(e => e.includes("send-gmail") && e.includes("placeholder"))) { console.log("MISS placeholder sin prompt"); bad++; }
// Literal inventado (NO en prompt) sigue flaggeado
const fakeNodes = [{ id: "w1", type: "action", data: { label: "Mail", config: { actionType: "resend/send-email", emailTo: "inventado@example.com" } } }];
const fakeErr = validateFlow(fakeNodes as never[], [], {}, undefined, { userPrompt: "mandame un mail a otro@dominio real" });
if (!fakeErr.some(e => e.includes("placeholder"))) { console.log("MISS placeholder inventado"); bad++; }

console.log(bad === 0 ? "ALL-RULES2 OK" : `${bad} problems`);
