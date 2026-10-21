// Chequeo estructural de un snapshot contra los expects de evals/cases.jsonl.
// Uso: node evals/structural-check.mjs <caseId> <snapshot.json>
// Vocabulario require: {action}, {trigger}, {composio_toolkit}, {label_contains}.
// forbid: orphans, handrolled_http, placeholders.
import fs from "fs";

const [caseId, snapPath] = process.argv.slice(2);
const cases = fs.readFileSync(new URL("./cases.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const kase = cases.find((c) => c.id === caseId);
if (!kase) { console.error("caso desconocido", caseId); process.exit(2); }
const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
const nodes = snap.nodes ?? [];
const edges = snap.edges ?? [];

const cfg = (n) => n?.data?.config ?? {};
// Los inner steps de un Loop cuentan como acciones del grafo (viven en config.steps).
const innerSteps = nodes.flatMap((n) => Array.isArray(cfg(n).steps) ? cfg(n).steps : []);
const actionTypes = [
  ...nodes.map((n) => cfg(n).actionType),
  ...innerSteps.map((s) => s?.actionType),
].filter(Boolean);
const triggerTypes = nodes.map((n) => cfg(n).triggerType).filter(Boolean);
const toolkits = [
  ...nodes.map((n) => cfg(n).toolkit ?? cfg(n).app),
  ...innerSteps.map((s) => s?.config?.toolkit ?? s?.config?.app),
].filter(Boolean);
const labels = [...nodes.map((n) => n?.data?.label ?? ""), ...innerSteps.map((s) => s?.label ?? s?.id ?? "")];

const violations = [];
for (const req of kase.expect?.require ?? []) {
  if (req.action && !actionTypes.includes(req.action)) violations.push(`falta acción requerida: ${req.action}`);
  if (req.trigger && !triggerTypes.includes(req.trigger)) violations.push(`falta trigger requerido: ${req.trigger}`);
  if (req.composio_toolkit && !toolkits.includes(req.composio_toolkit)) violations.push(`falta toolkit composio: ${req.composio_toolkit}`);
  if (req.label_contains && !labels.some((l) => l.toLowerCase().includes(req.label_contains.toLowerCase()))) violations.push(`falta nodo con label que contenga: ${req.label_contains}`);
}

const forbid = new Set(kase.expect?.forbid ?? []);
if (forbid.has("orphans") && nodes.length > 1) {
  const connected = new Set();
  for (const e of edges) { connected.add(e.source); connected.add(e.target); }
  const orphans = nodes.filter((n) => n.type !== "trigger" && !connected.has(n.id));
  if (orphans.length) violations.push(`huérfanos: ${orphans.map((n) => n.data?.label ?? n.id).join(", ")}`);
}
if (forbid.has("handrolled_http")) {
  const hr = nodes.filter((n) => /http.?request/i.test(cfg(n).actionType ?? "") || /http.?request/i.test(n.data?.label ?? ""));
  if (hr.length) violations.push(`http manual: ${hr.map((n) => n.data?.label ?? n.id).join(", ")}`);
}
if (forbid.has("placeholders")) {
  const ph = nodes.filter((n) => JSON.stringify(cfg(n)).match(/PLACEHOLDER|<TODO>|YOUR_[A-Z_]+/));
  if (ph.length) violations.push(`placeholders: ${ph.map((n) => n.data?.label ?? n.id).join(", ")}`);
}

console.log(JSON.stringify({ case: caseId, pass: violations.length === 0, violations }, null, 1));
