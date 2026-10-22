// unwiredReportStepError: TP en re13/re14 (pasos finales sin refs), sin FP en el resto.
// + placeholder inventado (_DRAFT) detectado por validateFlow en re13.
import { readFileSync, readdirSync } from "node:fs";
import { unwiredReportStepError, validateFlow } from "../../../lib/flow-validator";

const load = (f: string) => JSON.parse(readFileSync(`evals/semantic/snapshots/${f}`, "utf8"));
let bad = 0;
// Todas las corridas históricas donde la regla dispara son FAILs verificados
// (ninguna pasa ningún caso del harness): TP, no FP.
const EXPECTED = [
  "re13-final-rifs3ph5yat9oq6fxypgs.json",
  "re14-final-8ytao6745aqtkkwphj75f.json",
  "1esjmf6bc8csjr6qxyzu6.json",
  "42pm68opqhqyfj2z5xh0v.json",
  "4linjjd38e6788ud4rkxx.json",
  "7nv5v7oh2n0ixv70j4uwm.json",
  "dh97jfx40ziybq1bhgkok.json",
  "fulljson-g8vasdpj25lexi764pwi6.json",
  "y1e74nhzhofvl9e0i8gti.json",
  "re2-5zsf6gbhs210zfnxj7fhc.json",
  "re2-70itcgg1erjjqvp5m83h4.json",
  "re3-c1ng7jikdkt7j9h8x3u4l.json",
  "re4-58vf0480y0aq97arhmzfm.json",
  "re5-hw0ycjusgh239zupz6mkq.json",
  "re6-hoqkrboswh3oizv1mo1xx.json",
  "re6-j1rq5fxs8dzeymrepge66.json",
  "re6-opzkh4wjvjtwxl4yrur6p.json",
  "re7-8l88pqixvopqfu55dqvhi.json",
  "re11-final-f942f6pouyd35ig0zfk0u.json",
  "re11-raw-f942f6pouyd35ig0zfk0u.json",
];
for (const f of readdirSync("evals/semantic/snapshots")) {
  const wf = load(f);
  const err = unwiredReportStepError(wf.nodes ?? [], wf.edges ?? []);
  const expected = EXPECTED.includes(f);
  if (err && !expected) { console.log("FP unwired", f, ":", err.slice(0, 140)); bad++; }
  if (!err && expected) { console.log("MISS unwired", f); bad++; }
}
// re13: spreadsheet_id inventado "..._SPREADSHEET_ID_DRAFT" debe saltar en validateFlow
{
  const wf = load("re13-final-rifs3ph5yat9oq6fxypgs.json");
  const errs = validateFlow(wf.nodes ?? [], wf.edges ?? []);
  if (!errs.some((e) => e.includes("invented placeholder id"))) { console.log("MISS placeholder _DRAFT en re13:", errs.slice(0, 3)); bad++; }
}
// snapshots buenos no deben acusar placeholder inventado
for (const f of ["re12-final-q482692dkhdpdjryb7euu.json", "re13c12-uwlmkk76pzop0xn3nt1n1.json"]) {
  const wf = load(f);
  const errs = validateFlow(wf.nodes ?? [], wf.edges ?? []);
  const hit = errs.find((e) => e.includes("invented placeholder id"));
  if (hit) { console.log("FP placeholder", f, ":", hit.slice(0, 140)); bad++; }
}
if (bad) { console.log(`${bad} problems`); process.exit(1); }
console.log("ALL-RULES6 OK");
