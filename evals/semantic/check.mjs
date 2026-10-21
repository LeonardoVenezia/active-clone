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
const FIXTURES = {
  "C-02": "c02-shipping.json",
  "C-04": "c04-abandoned-cart.json",
  "C-05": "c05-questions.json",
  "C-07": "c07-support.json",
  "C-09": "c09-reconciliation.json",
  "C-12": "c12-stock.json",
};
const fixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures", FIXTURES[caseId]), "utf8")
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

const effectText = JSON.stringify({ sheetRows: log.sheetRows, emails: log.emails, slack: log.slack, whatsapp: log.whatsapp, mlAnswers: log.mlAnswers });
const resolvedCheck = () => {
  const missing = missingFieldRefs();
  add("campos-resueltos", missing.length === 0,
    missing.length === 0
      ? "todos los campos referenciados resuelven contra el fixture"
      : `campos referenciados inexistentes en los datos reales: ${missing.join(", ")}`);
};

if (caseId === "C-02") {
  const exp = fixture.expect;
  add("slack-cuando-demorado", (log.slack.length > 0) === exp.slackExpected,
    log.slack.length > 0 ? "Slack disparado (correcto: envío demorado)" : "Slack NO disparado y el envío estaba demorado");
  const wa = log.whatsapp.map((w) => String(w.text ?? ""));
  add("whatsapp-al-cliente", wa.length > 0 === exp.whatsappExpected,
    wa.length > 0 ? `${wa.length} WhatsApp enviado(s)` : "no se envió WhatsApp al cliente");
  for (const needle of exp.whatsappMustInclude) {
    add("whatsapp-con-tracking", wa.some((t) => t.includes(needle)),
      wa.some((t) => t.includes(needle))
        ? `el WhatsApp incluye "${needle}"`
        : `ningún WhatsApp incluye "${needle}" (textos: ${wa.map((t) => t.slice(0, 60)).join(" | ") || "ninguno"})`);
  }
  resolvedCheck();
} else if (caseId === "C-04") {
  const exp = fixture.expect;
  const wa = log.whatsapp.map((w) => String(w.text ?? ""));
  add("un-solo-whatsapp", wa.length === exp.whatsappCount,
    `${wa.length} WhatsApp enviados (esperados: ${exp.whatsappCount}; dos ramas activas = condiciones no excluyentes)`);
  for (const needle of exp.whatsappMustInclude) {
    add("rama-cupon", wa.some((t) => t.includes(needle)),
      wa.some((t) => t.includes(needle))
        ? `el mensaje corresponde a la rama del cupón ("${needle}")`
        : `el mensaje no menciona el cupón ("${needle}"); total del fixture: 80000 > 50000`);
  }
  const trues = log.conditions.filter((c) => c.result === true).length;
  add("condiciones-excluyentes", trues === 1,
    `${trues} condiciones en true (esperado: exactamente 1 de las 2 ramas)`);
  resolvedCheck();
} else if (caseId === "C-05") {
  const exp = fixture.expect;
  add("slack-por-pregunta", log.slack.length === exp.slackCount,
    `${log.slack.length} mensajes de Slack (esperados: ${exp.slackCount}, uno por pregunta sin responder)`);
  const allSlack = log.slack.map((m) => String(m.message ?? ""));
  for (const needle of exp.slackMustInclude) {
    add("pregunta-en-slack", allSlack.some((t) => t.includes(needle)),
      allSlack.some((t) => t.includes(needle))
        ? `"${needle.slice(0, 40)}" llegó a Slack`
        : `"${needle.slice(0, 40)}" NO aparece en ningún Slack`);
  }
  resolvedCheck();
} else if (caseId === "C-07") {
  const exp = fixture.expect;
  add("respuesta-unica", log.mlAnswers.length === exp.answersExpected,
    `${log.mlAnswers.length} respuestas en ML (esperadas: ${exp.answersExpected})`);
  const answers = log.mlAnswers.map((a) => String(a.text ?? ""));
  for (const needle of exp.answerMustInclude) {
    add("respuesta-con-politicas", answers.some((t) => t.includes(needle)),
      answers.some((t) => t.includes(needle))
        ? `la respuesta usa las políticas del Doc ("${needle}")`
        : `la respuesta NO refleja las políticas del Doc ("${needle}" faltante)`);
  }
  const qidOk = log.mlAnswers.every((a) => a.questionId && String(a.questionId).trim() !== "");
  add("question-id-presente", qidOk, qidOk ? "la respuesta lleva questionId" : "respuesta sin questionId");
  resolvedCheck();
} else if (caseId === "C-09") {
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
    whatsapp: log.whatsapp.length,
    mlAnswers: log.mlAnswers.length,
    loops: log.loops,
    errors: log.errors,
  },
}, null, 1));
process.exit(semanticPass ? 0 : 1);
