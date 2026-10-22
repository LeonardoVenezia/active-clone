import "/home/sandbox/ac/plugins/index";
import { readFileSync, readdirSync } from "node:fs";
import { listCrossingError, type FlowNode } from "/home/sandbox/ac/lib/flow-validator";

let bad = 0;
const c09 = readFileSync("/home/sandbox/ac/evals/cases.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l)).find(c => c.id === "C-09").prompt;
const load = (f: string) => JSON.parse(readFileSync("/home/sandbox/ac/evals/semantic/snapshots/" + f, "utf8"));

const expect: Array<[string, boolean, string]> = [
  // [snapshot, shouldPassValidation, nota]
  ["re6-j1rq5fxs8dzeymrepge66.json", true, "Fórmula con ambas listas (a)"],
  ["re6-gazeh0hcloippncnl8srb.json", true, "Loop con lookup per-ítem (b)"],
  ["re7-1bwvgsza2a52hzg35hzat.json", false, "loops eco sin cruce"],
  ["re2-bizmjdooc73ers4vns2n8.json", false, "dump loops"],
  ["re7-mqu47m0c379zzsu1960c1.json", false, "IA compara"],
];
for (const [f, shouldPass, note] of expect) {
  const err = listCrossingError(c09, load(f).nodes as FlowNode[]);
  const passes = err === null;
  if (passes !== shouldPass) { console.log(`${passes ? "FP" : "MISS"} (C-09 prompt) ${f} [${note}] err=${(err ?? "").slice(0, 80)}`); bad++; }
}
// C-12 con su propio prompt no debe disparar la regla de cruce
const c12 = readFileSync("/home/sandbox/ac/evals/cases.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l)).find(c => c.id === "C-12").prompt;
for (const f of ["re6-hoqkrboswh3oizv1mo1xx.json", "re6-opzkh4wjvjtwxl4yrur6p.json"]) {
  const err = listCrossingError(c12, load(f).nodes as FlowNode[]);
  if (err) { console.log(`FP C-12 ${f}: ${err.slice(0, 100)}`); bad++; }
}
console.log(bad === 0 ? "ALL-RULES4 OK" : `${bad} problems`);
