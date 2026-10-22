import "/home/sandbox/ac/plugins/index";
import { readFileSync, readdirSync } from "node:fs";
import { formulaExpressionError, type FlowNode } from "/home/sandbox/ac/lib/flow-validator";
import { getActionOutputFields, generateAIActionPrompts } from "/home/sandbox/ac/plugins/registry";

let bad = 0;
const load = (f: string) => JSON.parse(readFileSync("/home/sandbox/ac/evals/semantic/snapshots/" + f, "utf8"));

// Positivo: Fórmula ceremonial del live re7 C-09
const ceremonial = load("re7-8l88pqixvopqfu55dqvhi.json").nodes as FlowNode[];
const err1 = formulaExpressionError(ceremonial);
if (!err1 || !err1.includes("constant")) { console.log("MISS ceremonial:", err1); bad++; }

// Positivo: re6 C-09b también proyecta (`stripe` ignora tiendanube) => TP
const real = load("re6-j1rq5fxs8dzeymrepge66.json").nodes as FlowNode[];
const err2 = formulaExpressionError(real);
if (!err2 || !err2.includes("tiendanube")) { console.log("MISS proyección re6:", err2); bad++; }
// Negativo: Fórmula buena con input no-lista no se toca
const good = [{ id: "f1", data: { label: "Total", config: { actionType: "Fórmula", input: '{"n": 3}', expression: "n * 2" } } }] as unknown as FlowNode[];
const err3 = formulaExpressionError(good);
if (err3) { console.log("FP formula buena:", err3.slice(0, 120)); bad++; }

// Sin FP en ningún snapshot
const EXPECTED_FORMULA_HITS = ["re7-8l88pqixvopqfu55dqvhi.json", "28d8y1lxt7mrcv4uhwfqc.json", "re7-jv7o755aum5hu288w8rve.json", "re7-opx0evpqmbdtg0u5tbeqg.json", "re6-j1rq5fxs8dzeymrepge66.json", "re5-hw0ycjusgh239zupz6mkq.json"]; // constantes, JSONata inválido o proyección (TP)
for (const f of readdirSync("/home/sandbox/ac/evals/semantic/snapshots")) {
  const err = formulaExpressionError(load(f).nodes as FlowNode[]);
  if (EXPECTED_FORMULA_HITS.includes(f)) {
    if (!err) { console.log(`MISS formula esperada en ${f}`); bad++; }
    continue;
  }
  if (err) { console.log(`FP formula ${f}: ${err.slice(0, 100)}`); bad++; }
}

// Metadata: list-shipments ahora expone shipments, no raw
const of = getActionOutputFields();
const ls = of["zipnova/list-shipments"] ?? [];
if (!ls.includes("shipments") || ls.includes("raw")) { console.log("MISS metadata list-shipments:", ls); bad++; }

// Prompt: outputs con descripciones (enum de status visible)
const prompts = generateAIActionPrompts();
const znLine = prompts.split("\n").find((l) => l.includes("zipnova/get-shipment")) ?? "";
if (!znLine.includes("delayed")) { console.log("MISS enum en prompt:", znLine.slice(0, 150)); bad++; }
const lsLine = prompts.split("\n").find((l) => l.includes("zipnova/list-shipments")) ?? "";
if (!lsLine.includes("shipments")) { console.log("MISS shipments en prompt:", lsLine.slice(0, 150)); bad++; }

console.log(bad === 0 ? "ALL-RULES3 OK" : `${bad} problems`);
