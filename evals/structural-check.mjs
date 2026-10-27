// Chequeo estructural de un snapshot contra los expects de evals/cases.jsonl.
// Uso: node evals/structural-check.mjs <caseId> <snapshot.json>
// La lógica vive en ./structural.mjs (la reutiliza el arnés).
import fs from "fs";
import { structuralViolations } from "./structural.mjs";

const [caseId, snapPath] = process.argv.slice(2);
const cases = fs.readFileSync(new URL("./cases.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const kase = cases.find((c) => c.id === caseId);
if (!kase) { console.error("caso desconocido", caseId); process.exit(2); }
const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
const violations = structuralViolations(kase, snap);

console.log(JSON.stringify({ case: caseId, pass: violations.length === 0, violations }, null, 1));
