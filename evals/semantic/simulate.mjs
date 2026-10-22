/**
 * Simulador determinístico de flujos para aceptación semántica de evals.
 *
 * Replica la semántica del executor real (lib/workflow-executor.workflow.ts):
 * - processTemplates: reemplazo de {{@node:Label.path}} en strings; objetos se
 *   serializan con JSON.stringify; valores faltantes -> "".
 * - Condition: templates reemplazados por variables JS y evaluación con
 *   Function (mismo criterio, sin la whitelist de validación: acá la entrada
 *   la genera nuestro builder, no un usuario externo).
 * - Fórmula: JSONata sobre el input template-resuelto (parseado como JSON si
 *   es string).
 * - Loop: itera la fuente (máx 50), corre inner steps en cadena por ítem,
 *   una Condition false filtra el ítem (salta steps restantes), results =
 *   último step por ítem no filtrado.
 * - Fuentes de datos se mockean desde el fixture (formas idénticas a los
 *   outputs reales de los steps, ver plugins/<p>/steps/*.ts).
 *
 * Uso: node simulate.mjs <workflow.json> <fixture.json>
 * Salida: effect log JSON por stdout.
 */
import fs from "node:fs";
import jsonata from "jsonata";

const sanitize = (id) => String(id).replace(/[^a-zA-Z0-9]/g, "_");

function resolveFieldValue(data, fieldPath) {
  const fields = fieldPath.split(".");
  let current = data;
  const first = fields[0];
  if (
    current &&
    typeof current === "object" &&
    "success" in current &&
    "data" in current &&
    first !== "success" && first !== "data" && first !== "error"
  ) {
    current = current.data;
  }
  for (const field of fields) {
    if (!(current && typeof current === "object")) return undefined;
    const m = /^([^[]+)\[(\d+)\]$/.exec(field);
    current = m
      ? (Array.isArray(current[m[1]]) ? current[m[1]][Number(m[2])] : undefined)
      : current[field];
  }
  return current;
}

const TPL = /\{\{@([^:]+):([^}]+)\}\}/g;

export async function simulate(workflow, fixture) {
  const log = {
    workflow: workflow.name || null,
    sheetRows: [],
    emails: [],
    slack: [],
    whatsapp: [],
    mlAnswers: [],
    loops: [],
    formulas: [],
    conditions: [],
    fieldAccesses: [],
    unresolvedTemplates: [],
    errors: [],
    notes: [],
  };

  const outputs = {}; // sanitizedId -> { label, data }
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map();
  for (const e of edges) {
    incoming.set(e.target, [...(incoming.get(e.target) || []), e.source]);
  }

  function resolveTemplateRef(nodeId, rest) {
    const output = outputs[sanitize(nodeId)];
    if (!output) return { found: false, value: undefined };
    const dotIndex = rest.indexOf(".");
    if (dotIndex === -1) return { found: true, value: output.data };
    if (output.data === null || output.data === undefined) {
      return { found: true, value: undefined };
    }
    return { found: true, value: resolveFieldValue(output.data, rest.substring(dotIndex + 1)) };
  }

  // processTemplates fiel al executor
  // Paridad con workflow-executor.workflow.ts: estas keys guardan un JSON como
  // string; un template dentro de comillas ("key": "{{@...}}") se escapa.
  const JSON_STRING_CONFIG_KEYS = new Set(["arguments", "httpBody", "httpHeaders", "input", "responseSchema"]);
  const escapeForJsonString = (raw) => raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");

  function processTemplates(config, extraOutputs, where) {
    const scope = { ...outputs, ...extraOutputs };
    const processed = {};
    for (const [key, value] of Object.entries(config)) {
      if (typeof value !== "string") { processed[key] = value; continue; }
      const jsonStringKey = JSON_STRING_CONFIG_KEYS.has(key);
      processed[key] = value.replace(TPL, (match, nodeId, rest, offset, whole) => {
        let inJsonString = false;
        if (jsonStringKey && typeof offset === "number") {
          const before = whole.slice(0, offset);
          let inside = false;
          for (let i = 0; i < before.length; i++) { const ch = before[i]; if (ch === "\\") { i++; continue; } if (ch === '"') inside = !inside; }
          inJsonString = inside;
        }
        const output = scope[sanitize(nodeId)];
        if (!output) {
          log.unresolvedTemplates.push({ where, template: match, reason: "node output missing" });
          return match;
        }
        const dotIndex = rest.indexOf(".");
        const fieldPath = dotIndex === -1 ? null : rest.substring(dotIndex + 1);
        let current = output.data;
        if (fieldPath) {
          if (current === null || current === undefined) current = undefined;
          else current = resolveFieldValue(current, fieldPath);
        }
        log.fieldAccesses.push({
          where, node: nodeId, field: fieldPath,
          resolved: current !== undefined && current !== null,
        });
        if (current === null || current === undefined) return "";
        if (typeof current === "object") { const json = JSON.stringify(current); return inJsonString ? escapeForJsonString(json) : json; }
        const str = String(current);
        return inJsonString ? escapeForJsonString(str) : str;
      });
    }
    return processed;
  }

  function evalCondition(expression, extraOutputs, where) {
    if (typeof expression === "boolean") return expression;
    if (typeof expression !== "string") return Boolean(expression);
    const scope = { ...outputs, ...extraOutputs };
    const varNames = [];
    const varValues = [];
    let n = 0;
    const transformed = expression.replace(TPL, (match, nodeId, rest) => {
      const output = scope[sanitize(nodeId)];
      if (!output) {
        log.unresolvedTemplates.push({ where, template: match, reason: "node output missing (condition)" });
        return match;
      }
      const dotIndex = rest.indexOf(".");
      const value = dotIndex === -1
        ? output.data
        : (output.data == null ? undefined : resolveFieldValue(output.data, rest.substring(dotIndex + 1)));
      log.fieldAccesses.push({ where, node: nodeId, field: dotIndex === -1 ? null : rest.substring(dotIndex + 1), resolved: value !== undefined && value !== null });
      const varName = `__v${n++}`;
      varNames.push(varName);
      varValues.push(value);
      return varName;
    });
    try {
      const fn = new Function(...varNames, `return (${transformed});`);
      return Boolean(fn(...varValues));
    } catch (error) {
      log.errors.push({ where, error: `Condition eval failed: ${error.message}`, expression, transformed });
      return false;
    }
  }

  async function execAction(actionType, config, extraOutputs, where) {
    switch (actionType) {
      case "Condition": {
        const result = evalCondition(config.condition, extraOutputs, where);
        log.conditions.push({ where, expression: config.condition, result });
        return { condition: result };
      }
      case "Fórmula":
      case "Formula": {
        let data = config.input;
        if (typeof data === "string" && data.trim().length > 0) {
          try { data = JSON.parse(data); } catch { /* raw string */ }
        }
        try {
          const result = await jsonata(config.expression).evaluate(data ?? {});
          log.formulas.push({ where, expression: config.expression, result: result === undefined ? null : result });
          return { success: true, result: result === undefined ? null : result };
        } catch (error) {
          log.errors.push({ where, error: `Formula failed: ${error.message}`, expression: config.expression });
          return { success: false, error: error.message };
        }
      }
      case "Loop":
        return execLoop(config, extraOutputs, where);
      case "composio/run-tool": {
        let args = config.arguments;
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { log.errors.push({ where, error: "composio arguments no parsean como JSON", raw: args.slice(0, 300) }); }
        }
        const tool = config.tool || config.toolSlug || "";
        const composioFx = fixture?.sources?.[`composio/${tool}`];
        if (composioFx !== undefined) {
          // El executor guarda result.data como output del nodo y auto-unwrappea
          // {success, data}: el fixture se expone entero como ese data.
          return { success: true, data: composioFx };
        }
        if (tool.startsWith("GOOGLESHEETS")) {
          const values = args && typeof args === "object" ? (args.values || []) : [];
          log.sheetRows.push({ where, tool, values, spreadsheet: args?.spreadsheetId || args?.spreadsheet_id || null, range: args?.range || args?.sheet_name || null });
        } else if (tool.startsWith("GMAIL")) {
          log.emails.push({ where, tool, to: args?.recipient_email || args?.to || null, subject: args?.subject || null, body: args?.body || null });
        } else {
          log.notes.push({ where, note: `composio tool no mockeado: ${tool}` });
        }
        return { success: true, data: { simulated: true } };
      }
      case "slack/send-message": {
        log.slack.push({ where, channel: config.slackChannel || null, message: config.slackMessage || null });
        return { success: true, data: { messageId: "mock" } };
      }
      case "whatsapp/send-message": {
        log.whatsapp.push({ where, to: config.to || null, text: config.text || null });
        return { success: true, messageId: "mock", to: config.to || "" };
      }
      case "mercadolibre/answer-question": {
        log.mlAnswers.push({ where, questionId: config.questionId || null, text: config.text || null });
        return { success: true, questionId: config.questionId || "" };
      }
      case "ai-gateway/generate-text": {
        // Mock determinístico: el texto generado ES el prompt ya resuelto.
        // Permite verificar el cableado (qué datos llegaron al prompt), no la prosa.
        const text = String(config.aiPrompt ?? "");
        return { success: true, text, data: { text } };
      }
      default: {
        // Fuente de datos mockeada por fixture (por actionType, con override por nodo)
        const src = fixture?.sources?.[where.nodeId] ?? fixture?.sources?.[actionType];
        if (src !== undefined) {
          // __byArg: mock distinto según el valor de un argumento de config
          // (p.ej. get-question por questionId dentro de un Loop).
          if (src && typeof src === "object" && src.__byArg) {
            const [argField, byValue] = Object.entries(src.__byArg)[0] ?? [];
            const argVal = config[argField];
            const data = byValue?.[String(argVal)] ?? byValue?.__default;
            if (data !== undefined) return { success: true, ...data };
            return { success: false, error: `mock sin entrada para ${argField}=${argVal}` };
          }
          const data = typeof src === "function" ? src(config) : applyQueryMock(actionType, src, config);
          return { success: true, ...data };
        }
        log.notes.push({ where, note: `acción sin mock: ${actionType}` });
        return { success: true, data: {} };
      }
    }
  }

  // Mock de búsqueda: si hay config.query, filtra por campos de texto
  // (mimica "search by text" de tiendanube/mercadolibre search-orders).
  function applyQueryMock(actionType, src, config) {
    if (!actionType.includes("search-orders")) return src;
    const orders = src.orders || [];
    const query = (config.query ?? "").toString().trim().toLowerCase();
    const filtered = query
      ? orders.filter((o) => [o.number, o.email, o.customerEmail, o.customerName, o.customer_name, o.id]
          .filter((v) => v !== undefined && v !== null)
          .some((v) => String(v).toLowerCase().includes(query)))
      : orders;
    const limit = Number(config.limit) || filtered.length;
    const page = filtered.slice(0, limit);
    return { ...src, orders: page, count: page.length };
  }

  async function execLoop(config, baseExtra, where) {
    const source = typeof config.source === "string" ? config.source : "";
    let list;
    const m = source.match(/^\s*\{\{@([^:]+):([^}]+)\}\}\s*$/);
    if (m) {
      const { found, value } = (() => {
        const scope = { ...outputs, ...baseExtra };
        const output = scope[sanitize(m[1])];
        if (!output) return { found: false, value: undefined };
        const dotIndex = m[2].indexOf(".");
        const value = dotIndex === -1 ? output.data : resolveFieldValue(output.data, m[2].substring(dotIndex + 1));
        return { found: true, value };
      })();
      if (!found) {
        return { success: false, error: `Loop: fuente ${m[1]} no encontrada` };
      }
      list = value;
      if (list && typeof list === "object" && !Array.isArray(list) && "success" in list && "data" in list) list = list.data;
    } else {
      try { list = JSON.parse(source); } catch { list = undefined; }
    }
    if (!Array.isArray(list)) {
      log.errors.push({ where, error: `Loop source no es lista: ${source.slice(0, 120)}` });
      return { success: false, error: "Loop source is not a list" };
    }
    const rawSteps = Array.isArray(config.steps) ? config.steps : [];
    const maxItems = Math.min(Math.max(Number(config.maxItems) || 50, 1), 50);
    const items = list.slice(0, maxItems);
    const results = [];
    const loopItems = [];
    const failed = [];
    const filtered = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemOutputs = {
        item: { label: "Item", data: item },
        index: { label: "Index", data: { number: i } },
      };
      let itemResult = null;
      let itemFailed = false;
      let itemFiltered = false;
      const stepOutputs = {};
      for (let s = 0; s < rawSteps.length; s++) {
        const bodyStep = rawSteps[s];
        const stepId = sanitize(bodyStep.id || `step-${s + 1}`);
        const stepAction = bodyStep.actionType;
        if (!stepAction) { failed.push({ index: i, error: "inner step sin actionType" }); itemFailed = true; break; }
        const { id: _i, actionType: _a, steps: _s, config: bodyConfig, ...top } = bodyStep;
        const stepWhere = { nodeId: where.nodeId, step: stepId, item: i };
        const processed = processTemplates({ ...top, ...(bodyConfig || {}) }, itemOutputs, stepWhere);
        // Condition: el executor real NO sustituye valores inline en la expresión;
        // los convierte en variables ($__v0). Pasar la expresión cruda a evalCondition.
        if (stepAction === "Condition") processed.condition = (bodyConfig || top).condition;
        const bodyResult = await execAction(stepAction, processed, itemOutputs, stepWhere);
        if (bodyResult && typeof bodyResult === "object" && "success" in bodyResult && bodyResult.success === false) {
          failed.push({ index: i, step: stepAction, error: String(bodyResult.error || "failed") });
          itemFailed = true;
          break;
        }
        itemResult = bodyResult;
        stepOutputs[stepId] = bodyResult;
        itemOutputs[stepId] = { label: stepAction, data: bodyResult };
        if (stepAction === "Condition" && bodyResult && bodyResult.condition === false) {
          itemFiltered = true;
          break;
        }
      }
      if (itemFiltered) {
        filtered.push({ index: i });
        loopItems.push({ index: i, item, steps: stepOutputs, filtered: true });
      } else if (!itemFailed) {
        results.push(itemResult);
        loopItems.push({ index: i, item, steps: stepOutputs });
      }
    }
    log.loops.push({ where, items: items.length, completed: results.length, filtered: filtered.length, failed: failed.length });
    return {
      success: true,
      data: {
        results, items: loopItems, failed, filtered,
        count: items.length, completed: results.length,
        failedCount: failed.length, filteredCount: filtered.length,
        truncated: list.length > maxItems,
      },
    };
  }

  // Ejecución con semántica del executor: un nodo corre cuando algún padre
  // "dispara" (terminó OK y, si es Condition, su condición fue true) y todos
  // los padres que van a correr ya corrieron (merge any-parent, una vez).
  // Los nodos cuyos padres no disparan quedan muertos (gated off) y no corren.
  const executed = new Set();
  const firedParents = new Set(); // nodeIds que dispararon
  const dead = new Set();
  log.skippedNodes = [];

  async function execNodeOnce(node) {
    const where = { nodeId: node.id };
    if (node.data?.enabled === false) {
      outputs[sanitize(node.id)] = { label: node.data?.label || node.id, data: null };
      executed.add(node.id);
      firedParents.add(node.id);
      return;
    }
    if (node.type === "trigger" || node.data?.type === "trigger") {
      const tType = String(node.data?.config?.triggerType ?? "");
      const tFx = fixture?.sources?.[node.id] ?? (tType ? fixture?.sources?.[tType] : undefined);
      outputs[sanitize(node.id)] = { label: node.data?.label || node.id, data: tFx ?? { triggered: true } };
      executed.add(node.id);
      firedParents.add(node.id);
      return;
    }
    const config = node.data?.config || {};
    const actionType = config.actionType;
    if (!actionType) {
      log.errors.push({ where, error: "nodo acción sin actionType" });
      outputs[sanitize(node.id)] = { label: node.data?.label || node.id, data: null };
      executed.add(node.id); // no dispara
      return;
    }
    const processed = actionType === "Loop"
      ? config // el Loop resuelve su source y procesa inner steps por ítem
      : processTemplates(config, {}, where);
    if (actionType === "Condition") processed.condition = config.condition;
    const result = await execAction(actionType, processed, {}, where);
    const ok = !(result && typeof result === "object" && "success" in result && result.success === false);
    outputs[sanitize(node.id)] = {
      label: node.data?.label || node.id,
      data: result && typeof result === "object" && "data" in result ? result.data : result,
    };
    executed.add(node.id);
    if (ok) {
      if (actionType === "Condition") {
        if (result && result.condition === true) firedParents.add(node.id);
      } else {
        firedParents.add(node.id);
      }
    }
  }

  for (;;) {
    let progress = false;
    for (const node of nodes) {
      if (executed.has(node.id) || dead.has(node.id)) continue;
      const parents = incoming.get(node.id) || [];
      if (parents.length === 0) {
        if (node.type === "trigger" || node.data?.type === "trigger") {
          await execNodeOnce(node);
          progress = true;
        } else {
          dead.add(node.id); // acción desconectada: nunca corre
        }
        continue;
      }
      const anyFired = parents.some((p) => firedParents.has(p));
      const allSettled = parents.every((p) => executed.has(p) || dead.has(p));
      if (anyFired && allSettled) {
        await execNodeOnce(node);
        progress = true;
      }
    }
    if (!progress) {
      // marcar muertos: pendientes cuyos padres ya están todos settled y ninguno disparó
      for (const node of nodes) {
        if (executed.has(node.id) || dead.has(node.id)) continue;
        const parents = incoming.get(node.id) || [];
        if (parents.length > 0 &&
            parents.every((p) => executed.has(p) || dead.has(p)) &&
            !parents.some((p) => firedParents.has(p))) {
          dead.add(node.id);
          progress = true;
        }
      }
      if (!progress) break;
    }
  }
  for (const node of nodes) {
    if (dead.has(node.id)) log.skippedNodes.push(node.id);
    else if (!executed.has(node.id)) {
      log.errors.push({ where: null, error: `nodo no ejecutado (ciclo?): ${node.id}` });
    }
  }
  return log;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [wfPath, fixturePath] = process.argv.slice(2);
  const workflow = JSON.parse(fs.readFileSync(wfPath, "utf8"));
  const fixture = fixturePath ? JSON.parse(fs.readFileSync(fixturePath, "utf8")) : {};
  const log = await simulate(workflow, fixture);
  console.log(JSON.stringify(log, null, 1));
}
