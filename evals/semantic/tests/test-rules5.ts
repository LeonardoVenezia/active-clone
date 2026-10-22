// cyclicFlowError: TP en re7-91vject (ciclo real), sin FP en el resto
import { readFileSync, readdirSync } from "node:fs";
import { cyclicFlowError } from "/home/sandbox/ac/lib/flow-validator";

const load = (f: string) => JSON.parse(readFileSync(`/home/sandbox/ac/evals/semantic/snapshots/${f}`, "utf8"));
let bad = 0;
const EXPECTED = ["re7-91vject1e06fe38oef79e.json"];
for (const f of readdirSync("/home/sandbox/ac/evals/semantic/snapshots")) {
  const wf = load(f);
  const err = cyclicFlowError(wf.nodes ?? [], wf.edges ?? []);
  const expected = EXPECTED.includes(f);
  if (err && !expected) { console.log("FP ciclo", f, ":", err.slice(0, 120)); bad++; }
  if (!err && expected) { console.log("MISS ciclo", f); bad++; }
}
if (EXPECTED.length) {
  const wf = load(EXPECTED[0]);
  const err = cyclicFlowError(wf.nodes, wf.edges);
  if (!err || !err.includes("CICLO")) { console.log("MISS detalle ciclo:", err); bad++; }
}
if (bad) { console.log(`${bad} problems`); process.exit(1); }
console.log("ALL-RULES5 OK");
