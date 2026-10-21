/**
 * Aceptación semántica: corre el simulador sobre un workflow y contrasta el
 * effect log con lo esperado por el fixture del caso.
 *
 * Uso: node check.mjs <C-09|C-12> <workflow.json>
 * Salida: veredicto JSON por stdout (semanticPass, checks[], reasons[]).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "./simulate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [caseId, wfPath] = process.argv.slice(2);
const workflow = JSON.parse(fs.readFileSync(wfPath, "utf8"));
const fixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures",
    caseId === "C-09" ? "c09-reconciliation.json" : "c12-stock.json"), "utf8")
);
const log = await simulate(workflow, fixture);
const checks = [];
const reasons = [];
const add = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) reasons.push(`${name}: ${detail}`); };

// Campos referenciados por los templates que no existen en los items fuente
function missingFieldRefs() {
  const missing = {};
  for (const fa of log.fieldAccesses) {
    if (!fa.resolved && fa.field) missing[`${fa.node}.${fa.field}`] = true;
  }
  return Object.keys(missing);
}

const effectText = JSON.stringify({ sheetRows: log.sheetRows, emails: log.emails, slack: log.slack });

if (caseId === "C-09") {
  const exp = fixture.expect;
  for (const payId of exp.paymentsWithoutOrder) {
    add("detecta-cobro-sin-orden", effectText.includes(payId),
      effectText.includes(payId)
        ? `${payId} identificado en la salida`
        : `${payId} (cobro sin orden) no aparece en sheet/email/slack`);
  }
  for (const ordId of exp.ordersWithoutPayment) {
    add("detecta-orden-sin-cobro", effectText.includes(ordId),
      effectText.includes(ordId)
        ? `${ordId} identificada en la salida`
        : `${ordId} (orden sin cobro) no aparece en sheet/email/slack`);
  }
  const missing = missingFieldRefs();
  add("identificador-de-cruce-existe", missing.length === 0,
    missing.length === 0
      ? "todos los campos referenciados resuelven contra el fixture"
      : `campos referenciados inexistentes en los datos reales: ${missing.join(", ")}`);
} else if (caseId === "C-12") {
  const exp = fixture.expect;
  const rows = log.sheetRows.flatMap((r) => r.values || []);
  const flatCells = rows.flat().map((c) => String(c ?? ""));
  // Productos esperados detectados por id o nombre en cualquier efecto
  const detected = exp.lowStockProducts.filter((pid) => {
    const p = [...fixture.productsTruth.tiendanube, ...fixture.productsTruth.mercadolibre]
      .find((x) => x.id === pid);
    return effectText.includes(pid) || (p && effectText.includes(p.name));
  });
  // Filas vacías = pérdida de identidad del ítem (p.ej. loop sobre .results de un loop-filtro)
  const rowsWithEmpty = rows.filter((r) => r.some((c) => String(c ?? "").trim() === ""));
  add("productos-unicos-stock-bajo", detected.length === exp.uniqueExpected,
    `${detected.length}/${exp.uniqueExpected} productos únicos con stock bajo identificados en la salida` +
    (detected.length ? ` (detectados: ${detected.join(", ")})` : ""));
  add("sin-filas-vacias", rows.length > 0 && rowsWithEmpty.length === 0,
    rows.length === 0
      ? "no se escribió ninguna fila en Sheets"
      : `${rowsWithEmpty.length} de ${rows.length} filas con celdas vacías (identidad del ítem perdida)`);
  add("sin-falsos-positivos", !flatCells.some((c) => /^ord_/.test(c)),
    flatCells.some((c) => /^ord_/.test(c))
      ? `la salida referencia órdenes (${flatCells.filter((c) => /^ord_/.test(c)).join(", ")}) en vez de productos`
      : "ninguna fila referencia órdenes");
  add("slack-cuando-corresponde", (log.slack.length > 0) === exp.slackExpected,
    exp.slackExpected
      ? (log.slack.length > 0 ? "Slack disparado (correcto: >3 en falta)" : "Slack NO disparado y había >3 productos en falta")
      : (log.slack.length > 0 ? "Slack disparado pero no correspondía" : "Slack no disparado (correcto)"));
} else {
  console.error(`caso no soportado: ${caseId}`);
  process.exit(2);
}

const semanticPass = checks.every((c) => c.pass);
console.log(JSON.stringify({
  case: caseId,
  workflow: workflow.name,
  semanticPass,
  checks,
  reasons,
  stats: {
    sheetRows: log.sheetRows.length,
    emails: log.emails.length,
    slack: log.slack.length,
    loops: log.loops,
    errors: log.errors,
  },
}, null, 1));
process.exit(semanticPass ? 0 : 1);
