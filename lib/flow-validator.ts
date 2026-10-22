import jsonata from "jsonata";

/**
 * Deterministic post-generation validation for AI-built workflows.
 * Pure functions over the node/edge graph: no model, no I/O.
 * Each error is a concrete, actionable string fed back to the model
 * (and logged). Taxonomy: formato / grafo / semántica / consistencia.
 */

export type FlowNodeData = {
  label?: string;
  type?: string;
  config?: Record<string, unknown>;
};
export type FlowNode = { id: string; type?: string; data?: FlowNodeData };
export type FlowEdge = { id?: string; source: string; target: string };

type OutputsMap = Record<string, string[]>;

const TEMPLATE_RE = /\{\{@([\w-]+):([^}]+)\}\}/g;
const PLACEHOLDER_RES: RegExp[] = [
  /example\.(com|org|net)/i,
  /\bTODO\b/,
  /\blorem\s+ipsum\b/i,
  /<[a-z][a-z -]{2,}>/i,
  /\byour[_-][a-z]/i,
  /\/\/(?:tu|my|your)[-_][a-z0-9-]*\./i,
];

const SYSTEM_OUTPUTS: OutputsMap = {
  Loop: ["results", "items", "failed", "filtered", "count", "completed", "failedCount", "filteredCount"],
  Approval: ["approved", "note"],
  Fórmula: ["result"],
  "HTTP Request": ["data", "status", "success"],
  "Database Query": ["rows", "count", "success"],
};

function isTrigger(node: FlowNode): boolean {
  return node.type === "trigger" || node.data?.type === "trigger";
}

function actionTypeOf(node: FlowNode): string {
  return String(node.data?.config?.actionType ?? "");
}

/** Recursively collect every string value in a config object, with its key path. */
function collectStrings(value: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof value === "string") {
    out.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => collectStrings(item, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectStrings(v, path ? `${path}.${k}` : k, out);
    }
  }
}

function reachableFrom(roots: string[], edges: FlowEdge[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) {
      if (e.source === id && !seen.has(e.target)) queue.push(e.target);
    }
  }
  return seen;
}

export type ValidateFlowOptions = {
  validTriggerTypes?: ReadonlySet<string>;
  // "toolkit/slug" -> required argument names, from the loaded Composio catalog
  composioCatalog?: ReadonlyMap<string, string[]>;
  // actionId -> array output field -> item field names (for {{@item:Item.x}} checks)
  actionItemFields?: Record<string, Record<string, string[]>>;
  // Original user request: placeholder-looking literals the user explicitly
  // provided (e.g. a real email ending in example.com) are not placeholders.
  userPrompt?: string;
};

export function validateFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  actionOutputs: OutputsMap = {},
  validActionTypes?: ReadonlySet<string>,
  options: ValidateFlowOptions = {}
): string[] {
  const errors: string[] = [];
  const byId = new Map<string, FlowNode>();
  // Reverse adjacency for ancestor (reverse-BFS) checks: a {{@node}} reference
  // is only valid when the referenced node runs strictly BEFORE the referencing
  // one, i.e. it is an ancestor through the edge graph.
  const revAdj = new Map<string, string[]>();
  for (const e of edges) {
    if (!revAdj.has(e.target)) revAdj.set(e.target, []);
    (revAdj.get(e.target) as string[]).push(e.source);
  }
  const ancestorCache = new Map<string, Set<string>>();
  const ancestorsOf = (id: string): Set<string> => {
    const cached = ancestorCache.get(id);
    if (cached) return cached;
    const seen = new Set<string>();
    const queue = [...(revAdj.get(id) ?? [])];
    while (queue.length) {
      const c = queue.pop() as string;
      if (seen.has(c)) continue;
      seen.add(c);
      queue.push(...(revAdj.get(c) ?? []));
    }
    ancestorCache.set(id, seen);
    return seen;
  };
  for (const n of nodes) {
    if (byId.has(n.id)) errors.push(`grafo: duplicate node id "${n.id}" added twice`);
    byId.set(n.id, n);
  }

  const triggers = nodes.filter(isTrigger);
  if (triggers.length === 0) errors.push("grafo: the workflow has no trigger node");
  if (triggers.length > 1) errors.push(`grafo: ${triggers.length} trigger nodes; exactly one is required`);
  for (const t of triggers) {
    const tcfg = (t.data?.config ?? {}) as Record<string, unknown>;
    const tType = String(tcfg.triggerType ?? "");
    if (options.validTriggerTypes && !options.validTriggerTypes.has(tType)) {
      errors.push(`grafo: trigger "${t.id}" (${t.data?.label ?? "unlabeled"}) has unknown triggerType "${tType || "(missing)"}"; use Manual, Webhook, Schedule, or one of the listed plugin triggers`);
    }
    if (tType === "Webhook" && !tcfg.webhookPath) {
      errors.push(`grafo: trigger "${t.id}" (${t.data?.label ?? "unlabeled"}) is a Webhook but has no webhookPath`);
    }
  }

  for (const e of edges) {
    if (!byId.has(e.source)) errors.push(`grafo: edge ${e.source} -> ${e.target} references missing node "${e.source}"`);
    if (!byId.has(e.target)) errors.push(`grafo: edge ${e.source} -> ${e.target} references missing node "${e.target}"`);
  }

  if (triggers.length > 0) {
    const reachable = reachableFrom(triggers.map((t) => t.id), edges);
    for (const n of nodes) {
      if (!isTrigger(n) && !reachable.has(n.id)) {
        errors.push(`grafo: node "${n.id}" (${n.data?.label ?? "unlabeled"}) is not connected from the trigger`);
      }
    }
  }

  const outputsOf = (actionType: string): string[] | undefined =>
    actionOutputs[actionType] ?? SYSTEM_OUTPUTS[actionType];

  for (const n of nodes) {
    const label = n.data?.label ?? n.id;
    const cfg = n.data?.config ?? {};
    const actionType = actionTypeOf(n);

    if (!isTrigger(n)) {
      if (!actionType) {
        errors.push(`semántica: node "${n.id}" (${label}) has no actionType in its config`);
      } else if (validActionTypes && !validActionTypes.has(actionType)) {
        errors.push(`semántica: node "${n.id}" (${label}) has unknown actionType "${actionType}"; use a system action (Database Query, HTTP Request, Condition, Delay, Fórmula, Loop) or a plugin action id from the list (e.g. "slack/send-message")`);
      }
    }

    // ai-gateway/generate-text format checks
    if (actionType === "ai-gateway/generate-text") {
      const fmt = cfg.aiFormat;
      if (fmt !== undefined && fmt !== "text" && fmt !== "object") {
        errors.push(`semántica: node "${n.id}" (${label}) has aiFormat "${String(fmt)}"; valid values are "text" or "object"`);
      }
      if (fmt === "object" && !cfg.aiSchema) {
        errors.push(`semántica: node "${n.id}" (${label}) uses aiFormat "object" but has no aiSchema`);
      }
    }

    // Loop structure
    if (actionType === "Loop") {
      const source = cfg.source;
      if (typeof source !== "string" || !TEMPLATE_RE.test(source)) {
        TEMPLATE_RE.lastIndex = 0;
        errors.push(`semántica: Loop node "${n.id}" (${label}) needs "source" pointing to an array field of an earlier step ({{@node-id:Label.arrayField}})`);
      }
      TEMPLATE_RE.lastIndex = 0;
      const steps = cfg.steps;
      if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3) {
        errors.push(`semántica: Loop node "${n.id}" (${label}) must have 1 to 3 inner steps`);
      } else {
        for (const [i, step] of steps.entries()) {
          const s = step as { actionType?: unknown; config?: unknown; id?: unknown };
          if (!s.actionType) errors.push(`semántica: Loop "${n.id}" inner step ${i + 1} has no actionType`);
          if (validActionTypes && typeof s.actionType === "string" && s.actionType && !validActionTypes.has(s.actionType)) {
            errors.push(`semántica: Loop "${n.id}" inner step ${i + 1} has unknown actionType "${s.actionType}"; use an action from the provided list`);
          }
          if (s.actionType === "Loop") errors.push(`semántica: Loop "${n.id}" contains a nested Loop; nesting is not supported`);
          if (!s.config || typeof s.config !== "object") {
            errors.push(`semántica: Loop "${n.id}" inner step ${i + 1} must keep all parameters inside its "config" object`);
          }
        }
      }
    }

    // Native plugin preferred over generic actions and over Composio for apps with a native plugin
    const NATIVE_PLUGIN_APPS: Array<[RegExp, string, string]> = [
      [/whatsapp/i, "whatsapp", "whatsapp/send-message"],
      [/slack/i, "slack", "slack/send-message"],
      [/mercado\s*libre|mercadolibre/i, "mercadolibre", "mercadolibre/*"],
      [/tiendanube/i, "tiendanube", "tiendanube/*"],
      [/zipnova/i, "zipnova", "zipnova/*"],
    ];
    const isComposio = actionType === "composio/run-tool" || actionType === "Run Composio Action";
    const composioToolkit = isComposio ? String(cfg.toolkit ?? cfg.toolKit ?? "").toLowerCase() : "";
    if (isComposio && options.composioCatalog && options.composioCatalog.size > 0) {
      const slug = String(cfg.toolSlug ?? cfg.tool ?? cfg.slug ?? "");
      const key = `${composioToolkit}/${slug}`;
      const required = options.composioCatalog.get(key);
      if (!required) {
        errors.push(`consistencia: node "${n.id}" (${label}) uses Composio action "${key}" which is NOT in the loaded catalog; use only exact toolkit/slug pairs from the REAL COMPOSIO ACTIONS list`);
      } else if (required.length) {
        let provided: Record<string, unknown> = {};
        try { provided = JSON.parse(String(cfg.arguments ?? "{}")) as Record<string, unknown>; } catch { provided = {}; }
        const missing = required.filter((arg) => !(arg in provided));
        if (missing.length) {
          errors.push(`consistencia: node "${n.id}" (${label}) Composio action "${key}" is missing required arguments: ${missing.join(", ")}`);
        }
      }
    }
    for (const [re, app, example] of NATIVE_PLUGIN_APPS) {
      const mentionsApp = re.test(label);
      const composioHitsNative = isComposio && (composioToolkit === app || composioToolkit.replace(/[\s_-]/g, "") === app);
      const genericHitsNative = (actionType === "Send Message" || actionType === "Send Email") && mentionsApp;
      if (composioHitsNative || genericHitsNative) {
        errors.push(`consistencia: node "${n.id}" (${label}) uses ${isComposio ? `the Composio ${app} toolkit` : `generic action "${actionType}"`} but ${app} has a NATIVE plugin; you MUST use the native plugin action (e.g. "${example}") instead`);
        break;
      }
    }

    // Hand-rolled HTTP Request to an API that has a native plugin or Composio action
    if (actionType === "HTTP Request") {
      const endpoint = String(cfg.endpoint ?? "");
      const KNOWN_API_HOSTS: Array<[RegExp, string]> = [
        [/sheets\.googleapis\.com|docs\.google\.com\/spreadsheets/i, "Google Sheets (Composio googlesheets)"],
        [/gmail\.googleapis\.com/i, "Gmail (Composio gmail)"],
        [/graph\.microsoft\.com/i, "Outlook (Composio outlook)"],
        [/slack\.com\/api/i, "Slack (slack/* plugin)"],
        [/api\.notion\.com/i, "Notion (Composio notion)"],
        [/api\.airtable\.com/i, "Airtable (Composio airtable)"],
        [/api\.github\.com/i, "GitHub (github/* plugin)"],
        [/api\.stripe\.com/i, "Stripe (stripe/* plugin)"],
        [/api\.hubapi\.com/i, "HubSpot (Composio hubspot)"],
        [/api\.linear\.app/i, "Linear (linear/* plugin)"],
        [/api\.perplexity\.ai/i, "Perplexity (perplexity/* plugin)"],
        [/api\.mercadopago\.com/i, "Mercado Pago (mercadopago/* plugin)"],
      ];
      for (const [re, name] of KNOWN_API_HOSTS) {
        if (re.test(endpoint)) {
          errors.push(`consistencia: node "${n.id}" (${label}) hand-rolls an HTTP Request to the ${name} API; you MUST use that app's plugin action or its exact Composio catalog action instead (never a manual HTTP Request to an app that has one)`);
          break;
        }
      }
    }

    // Delay sanity
    if (actionType === "Delay") {
      const minutes = Number(cfg.durationMinutes ?? 0) || 0;
      const seconds = Number(cfg.durationSeconds ?? 0) || 0;
      if (Math.round(minutes * 60 + seconds) <= 0) {
        errors.push(`semántica: Delay node "${n.id}" (${label}) needs a positive duration (durationMinutes and/or durationSeconds)`);
      }
    }

    // Condition sanity
    if (actionType === "Condition") {
      const cond = cfg.condition;
      if (typeof cond !== "string" || !cond.trim()) {
        errors.push(`semántica: Condition node "${n.id}" (${label}) has an empty condition`);
      } else if (!cond.includes("{{@") && !/(===|!==|>=|<=|>\s|<\s|\$count|\$)/.test(cond)) {
        errors.push(`semántica: Condition node "${n.id}" (${label}) must reference a previous step output ({{@...}}) or compare values`);
      } else {
        // Incomplete expression: an operator without its left (or right) operand
        // crashes the evaluator at runtime ("Unexpected token").
        const stripped = cond.replace(/\{\{[^}]*\}\}/g, " x ").trim();
        const OP = "(={2,3}|!={1,2}|[><]=?|&&|\\|\\|)";
        if (new RegExp("^" + OP).test(stripped) || new RegExp(OP + "$").test(stripped)) {
          errors.push(`semántica: Condition node "${n.id}" (${label}) has an incomplete expression ("${cond.slice(0, 60)}"); write the FULL comparison with both operands, e.g. "{{@node-id:Label.totalStock}} < 5"`);
        }
      }
    }

    // Writing a raw list output as a single value: one row/item per element needs a Loop,
    // otherwise the list must be aggregated to a scalar first. Applies to every node
    // (not just Composio); the Loop "source" field legitimately points at a raw list.
    {
      const rawListRe = /\{\{@([\w-]+):[^}]*\.(orders|payments|products|items|questions|results)\}\}/;
      const cfgStrings: Array<{ path: string; value: string }> = [];
      collectStrings(cfg, "", cfgStrings);
      for (const { path, value } of cfgStrings) {
        if (actionType === "Loop" && path === "source") continue;
        const rawList = value.match(rawListRe);
        if (!rawList || rawList[1] === "item") continue;
        errors.push(`semántica: node "${n.id}" (${label}) writes the raw list field ".${rawList[2]}" from "${rawList[1]}" as a single value; one row/item per list element MUST go through a Loop (with filter/compare as inner steps), aggregate the list to a scalar first (count, total, summary), or - when you need the DETAIL of one element (e.g. the latest order) - add the plugin's get-* detail step after "${rawList[1]}" and reference that instead`);
        break;
      }
    }

    // AI text node used to compare/filter list outputs: same rule as Fórmula
    // over lists. The comparison must be deterministic (Loop + Condition),
    // not LLM prose over serialized lists.
    if (actionType === "ai-gateway/generate-text") {
      const txt = JSON.stringify(cfg);
      const refs = [...txt.matchAll(/\{\{@([\w-]+):/g)].map((m) => m[1]);
      const listRef = refs.some((id) => {
        const target = byId.get(id);
        const targetType = target ? actionTypeOf(target) : "";
        return /search|list|get-question/i.test(targetType);
      });
      const perItemIntent = /compar|diferenc|filtr|faltante|sin stock|stock bajo|reconcil|cada|per[- ]item|por [íi]tem/i.test(`${label} ${String(cfg.aiPrompt ?? "").slice(0, 400)}`);
      if (listRef && perItemIntent) {
        errors.push(`semántica: node "${n.id}" (${label}) compares/filters list outputs with an AI text node; per-item list comparison MUST be deterministic: a Loop node whose inner steps do the per-item check (Condition inside the Loop), not LLM prose over serialized lists`);
      }
    }

    // Google Sheets writes: data rows must come from {{@...}} references, not
    // hardcoded fake values. A literal first row is fine (headers).
    if (isComposio) {
      const toolName = String(cfg.toolSlug ?? cfg.tool ?? cfg.slug ?? "");
      if (toolName.startsWith("GOOGLESHEETS")) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(cfg.arguments ?? "{}")) as Record<string, unknown>; } catch { args = {}; }
        const values = args && Array.isArray(args.values) ? (args.values as unknown[]) : null;
        if (values && values.length > 1) {
          for (let i = 1; i < values.length; i++) {
            const row = Array.isArray(values[i]) ? (values[i] as unknown[]) : [values[i]];
            const cells = row.map((c) => String(c ?? ""));
            if (cells.every((c) => c.trim() === "")) continue;
            if (cells.every((c) => !c.includes("{{@"))) {
              errors.push(`consistencia: node "${n.id}" (${label}) hardcodes a data row in Google Sheets ("${cells.join(" | ").slice(0, 60)}"); data values MUST come from {{@...}} references to real step outputs (a literal first row is fine for headers)`);
              break;
            }
          }
        }
      }
    }

    // Fórmula over lists: comparing or filtering list outputs item-by-item requires a Loop.
    // Wholesale aggregation (sum, count, totals) in a Fórmula is fine.
    if (actionType === "Fórmula") {
      const txt = JSON.stringify(cfg);
      const refs = [...txt.matchAll(/\{\{@([\w-]+):/g)].map((m) => m[1]);
      const listRef = refs.some((id) => {
        const target = byId.get(id);
        const targetType = target ? actionTypeOf(target) : "";
        return /search|list|get-question/i.test(targetType);
      });
      const perItemIntent = /compar|diferenc|filtr|faltante|sin stock|stock bajo|cada|per[- ]item|por [íi]tem/i.test(`${label} ${txt.slice(0, 300)}`);
      if (listRef && perItemIntent) {
        errors.push(`semántica: node "${n.id}" (${label}) compares/filters list outputs in a single Fórmula step; per-item list processing MUST be a Loop node whose inner steps do the per-item check (Condition inside the Loop for per-item filters/alerts); aggregate or notify AFTER the Loop`);
      }
    }

    // @item/@index are only valid inside a Loop's inner steps
    if (actionType !== "Loop") {
      const ownStrings: Array<{ path: string; value: string }> = [];
      collectStrings(cfg, "", ownStrings);
      for (const { path, value } of ownStrings) {
        const m = value.match(/\{\{@(item|index):/);
        if (m) {
          errors.push(`semántica: node "${n.id}" (${label}) field "${path}" uses {{@${m[1]}}} which only exists INSIDE a Loop's inner steps; reference a real earlier node instead`);
        }
      }
    }

    // Placeholders + template reference integrity (recurses into Loop inner steps)
    // Loop context: source array's item fields (when the source action
    // describes them) and sibling inner-step ids, for {{@item:...}} and
    // inner-step reference checks.
    let loopItemFields: string[] | undefined;
    let loopSourceDesc = "";
    const innerStepActions = new Map<string, string>();
    if (actionType === "Loop") {
      const srcMatch = typeof cfg.source === "string" ? /^\s*\{\{@([\w-]+):([^}]+)\}\}\s*$/.exec(cfg.source) : null;
      if (srcMatch) {
        const srcNode = byId.get(srcMatch[1]);
        const srcAction = srcNode ? actionTypeOf(srcNode) : "";
        const rest = srcMatch[2];
        const arrayField = rest.includes(".") ? rest.slice(rest.indexOf(".") + 1).split(".")[0]?.split("[")[0] : "";
        loopSourceDesc = `${srcAction}.${arrayField}`;
        loopItemFields = options.actionItemFields?.[srcAction]?.[arrayField ?? ""];
      }
      const rawSteps = Array.isArray(cfg.steps) ? cfg.steps : [];
      for (const [i, st] of rawSteps.entries()) {
        const step = st as { id?: unknown; actionType?: unknown };
        const stepId = typeof step.id === "string" && step.id ? step.id : `step-${i + 1}`;
        if (typeof step.actionType === "string" && step.actionType) {
          innerStepActions.set(stepId, step.actionType);
        }
      }
    }

    const strings: Array<{ path: string; value: string }> = [];
    collectStrings(cfg, "", strings);
    for (const { path, value } of strings) {
      // WordPress REST placeholders (<site>, app-password auth) are intentional per the builder rules
      if (value.includes("/wp-json/")) continue;
      for (const re of PLACEHOLDER_RES) {
        if (re.test(value)) {
          // User-provided literals are not placeholders: if every email/URL-ish
          // token in this value appears verbatim in the original request, keep it.
          if (options.userPrompt) {
            const tokens = value.match(/[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/[^\s"'}]+/g) ?? [];
            if (tokens.length > 0 && tokens.every((t) => (options.userPrompt as string).includes(t))) continue;
          }
          if (/endpoint|url/i.test(path)) {
            errors.push(`consistencia: node "${n.id}" (${label}) field "${path}" has a placeholder URL ("${value.slice(0, 60)}"); if an action for this app exists in the plugin list or the live Composio catalog you MUST use that action instead of a hand-rolled HTTP Request; otherwise set the real endpoint (if the user explicitly provided this exact value, keep it)`);
          } else {
            errors.push(`consistencia: node "${n.id}" (${label}) field "${path}" looks like a placeholder ("${value.slice(0, 60)}"); use a real value or a {{@...}} reference`);
          }
          break;
        }
      }
      // Invented resource ids ("1A2B3C4D5E6F_SPREADSHEET_ID_DRAFT"): the model
      // fabricating a placeholder id instead of the resource name the user gave.
      // Skipped when the exact value came from the user's own request.
      if (!options.userPrompt || !options.userPrompt.includes(value)) {
        if (/_DRAFT\b/i.test(value) || /(?:spreadsheet|sheet|document|calendar)[_-]?id"?\s*[:=]\s*"[^"]*(?:DRAFT|PLACEHOLDER|EXAMPLE|TBD|CHANGEME|INSERT|YOUR)[^"]*"/i.test(value)) {
          errors.push(`consistencia: node "${n.id}" (${label}) field "${path}" has an invented placeholder id ("${value.slice(0, 60)}"); use the exact resource NAME the user gave in the request or their config answer (mock mode accepts a name) - never fabricate an id`);
        }
      }
      for (const match of value.matchAll(TEMPLATE_RE)) {
        const refId = match[1];
        if (refId === "index") continue;
        if (refId === "item") {
          const rest = match[2];
          // {{@item:Item}} (the whole item) is always fine.
          if (rest === "Item" || !rest.includes(".")) continue;
          // (@item outside a Loop is flagged by the dedicated rule below.)
          // {{@item:Item.field}} inside a Loop: check the field against the
          // source array's item shape when the action describes it.
          if (!loopItemFields) continue;
          const itemPath = rest.slice(5); // empieza con "Item." (chequeado arriba)
          const firstField = itemPath.split(".")[0]?.split("[")[0];
          if (firstField && !loopItemFields.includes(firstField)) {
            errors.push(`semántica: Loop "${n.id}" (${label}) references "{{@item:Item.${firstField}}}" but items from ${loopSourceDesc} only have: ${loopItemFields.join(", ")}`);
          }
          continue;
        }
        const target = byId.get(refId);
        if (!target) {
          const stepAction = innerStepActions.get(refId);
          if (stepAction) {
            // Reference to a sibling inner step: validate its output field.
            const rest = match[2];
            const fieldPath = rest.includes(".") ? rest.slice(rest.indexOf(".") + 1) : rest;
            const firstField = fieldPath.split(".")[0]?.split("[")[0];
            const known = outputsOf(stepAction);
            if (known && firstField && !known.includes(firstField)) {
              errors.push(`semántica: node "${n.id}" (${label}) references "${refId}.${firstField}" but ${stepAction} only outputs: ${known.join(", ")}`);
            }
            continue;
          }
          errors.push(`grafo: node "${n.id}" (${label}) field "${path}" references node "${refId}" which was never added`);
          continue;
        }
        if (!ancestorsOf(n.id).has(refId)) {
          errors.push(`grafo: node "${n.id}" (${label}) references "${refId}" but no path runs from "${refId}" to it; a {{@...}} reference only works from an EARLIER step - wire the flow so "${refId}" runs before "${n.id}", or reference the correct earlier node`);
          continue;
        }
        // Field check: ref text after ":" is "<Label>.<field.path>"; strip the target's label.
        const rest = match[2];
        const targetLabel = target.data?.label ?? "";
        let fieldPath = "";
        if (targetLabel && rest.startsWith(`${targetLabel}.`)) {
          fieldPath = rest.slice(targetLabel.length + 1);
        } else if (!targetLabel || !rest.startsWith(targetLabel)) {
          fieldPath = rest.includes(".") ? rest.slice(rest.indexOf(".") + 1) : rest;
        }
        const firstField = fieldPath.split(".")[0]?.split("[")[0];
        const targetAction = actionTypeOf(target);
        // composio/run-tool devuelve un payload dinámico por tool
        // ({success, data: {...}}) y el executor lo auto-unwrappea: no se
        // puede validar el campo de primer nivel.
        const known = targetAction === "composio/run-tool" || targetAction === "Run Composio Action" ? undefined : outputsOf(targetAction);
        if (known && firstField && !known.includes(firstField)) {
          errors.push(`semántica: node "${n.id}" (${label}) references "${refId}.${firstField}" but ${actionTypeOf(target)} only outputs: ${known.join(", ")}`);
        }
        // Path que entra a un item de un array conocido (orders[0].shipping_id
        // u orders.shipping_id): validar el campo del item contra la forma
        // declarada; si el campo buscado lo tiene el get-* de detalle del
        // mismo plugin, sugerir ese paso intermedio.
        if (firstField && known?.includes(firstField)) {
          const itemFields = options.actionItemFields?.[targetAction]?.[firstField];
          const seg = fieldPath.split(".").slice(1);
          const itemField = seg.length ? seg[0]?.split("[")[0] : "";
          if (itemFields && itemField && !itemFields.includes(itemField)) {
            const plugin = targetAction.split("/")[0];
            const detailAction = Object.keys(actionOutputs).find((a) => a.startsWith(`${plugin}/get-`));
            const hint = detailAction && (actionOutputs[detailAction] ?? []).includes(itemField)
              ? `; that field is only on the DETAIL output, add a "${detailAction}" step after "${refId}" and reference it instead`
              : "";
            errors.push(`semántica: node "${n.id}" (${label}) references "${refId}.${firstField}[].${itemField}" but items from ${targetAction}.${firstField} only have: ${itemFields.join(", ")}${hint}`);
          }
        }
      }
    }
  }

  // Condition gates both a node and its downstream: when the condition is false,
  // everything after it dies, which is almost never the intent ("only if X do Y, then continue").
  {
    const out = new Map<string, string[]>();
    for (const e of edges) {
      if (!out.has(e.source)) out.set(e.source, []);
      (out.get(e.source) as string[]).push(e.target);
    }
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set<string>();
      const q = [...(out.get(from) ?? [])];
      while (q.length) {
        const c = q.pop() as string;
        if (c === to) return true;
        if (seen.has(c)) continue;
        seen.add(c);
        q.push(...(out.get(c) ?? []));
      }
      return false;
    };
    for (const n of nodes) {
      if (actionTypeOf(n) !== "Condition") continue;
      const targets = out.get(n.id) ?? [];
      for (const a of targets) {
        for (const b of targets) {
          if (a !== b && reaches(a, b)) {
            errors.push(`consistencia: Condition "${n.id}" (${n.data?.label ?? ""}) connects to both "${a}" and its downstream "${b}"; when it is false the whole rest of the flow is skipped. For "only if X do Y, then continue either way", use TWO conditions (X and NOT X): X -> Y -> Z and NOT X -> Z`);
          }
        }
      }
    }
  }

  return errors;
}

/** Longest trailing numbered-list block in the prompt (an approved plan) vs nodes on the canvas. */
export function planCoverageError(promptText: string, nodes: FlowNode[]): string | null {
  const lines = promptText.split("\n");
  let run: string[] = [];
  let best: string[] = [];
  for (const line of lines) {
    if (/^\s*\d+[.)]\s+\S/.test(line)) run.push(line.trim());
    else { if (run.length >= 4) best = run; run = []; }
  }
  if (run.length >= 4) best = run;
  if (best.length < 4) return null;
  const actionCount = nodes.filter((n) => !isTrigger(n)).length;
  if (actionCount >= best.length - 1) return null;
  return `consistencia: the request/plan lists ${best.length} numbered steps but the canvas only has ${actionCount} action nodes; add the missing steps as nodes and wire them. Steps: ${best.join(" | ").slice(0, 1500)}`;
}

/** Known integration names: pattern over a request step -> pattern over a node's text. */
const APP_MENTIONS: Array<[RegExp, RegExp, string]> = [
  [/tiendanube/i, /tiendanube/i, "Tiendanube"],
  [/zipnova/i, /zipnova/i, "Zipnova"],
  [/slack/i, /slack/i, "Slack"],
  [/whatsapp/i, /whatsapp/i, "WhatsApp"],
  [/mercado\s?pago/i, /mercadopago|mercado\s?pago/i, "Mercado Pago"],
  [/mercado\s?libre/i, /mercadolibre|mercado\s?libre/i, "Mercado Libre"],
  [/(?:google\s+)?sheets?|planilla|spreadsheet|hoja de c[aá]lculo/i, /googlesheets|google\s+sheets|spreadsheet/i, "Google Sheets"],
  [/google\s+docs?\b|documento de google/i, /googledocs|google\s+docs/i, "Google Docs"],
  [/wordpress/i, /wordpress|wp-json/i, "WordPress"],
  [/perplexity/i, /perplexity/i, "Perplexity"],
  [/gmail/i, /gmail/i, "Gmail"],
  [/notion/i, /notion/i, "Notion"],
  [/stripe/i, /stripe/i, "Stripe"],
  [/hubspot/i, /hubspot/i, "HubSpot"],
  [/linear/i, /linear/i, "Linear"],
  [/airtable/i, /airtable/i, "Airtable"],
  [/jira/i, /jira/i, "Jira"],
  [/supabase/i, /supabase/i, "Supabase"],
  [/github/i, /github/i, "GitHub"],
  [/enviopack/i, /enviopack/i, "Enviopack"],
  [/correo\s?argentino/i, /correoargentino|correo\s?argentino/i, "Correo Argentino"],
  [/\bvtex\b/i, /vtex/i, "VTEX"],
  [/alegra/i, /alegra/i, "Alegra"],
  [/xubio/i, /xubio/i, "Xubio"],
  [/webflow/i, /webflow/i, "Webflow"],
];

function nodeHaystack(node: FlowNode): string {
  // Only the node's identity fields: label, action/trigger type, toolkit.
  // Message bodies and prompts mention apps without USING them ("tu carrito
  // en Tiendanube"), so config text must not count as coverage.
  const cfg = (node.data?.config ?? {}) as Record<string, unknown>;
  const parts: unknown[] = [node.data?.label, cfg.actionType, cfg.triggerType, cfg.toolkit, cfg.toolKit, cfg.toolSlug, cfg.tool, cfg.slug];
  // Loop inner steps count as coverage too (e.g. slack/send-message inside the Loop).
  const steps = Array.isArray(cfg.steps) ? (cfg.steps as Array<Record<string, unknown>>) : [];
  for (const st of steps) parts.push(st?.actionType, st?.label);
  return parts
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();
}

/**
 * Semantic coverage: every numbered step of the user's request that names a known
 * integration must have at least one node using that integration. Catches steps the
 * model silently dropped even when the raw node count looks fine.
 */
function extractRequestSteps(promptText: string): string[] {
  const steps: string[] = [];
  for (const line of promptText.split("\n")) {
    if (!/\d{1,2}[.)]\s+\S/.test(line)) continue;
    for (const part of line.split(/(?=\b\d{1,2}[.)]\s)/)) {
      if (/^\s*\d{1,2}[.)]\s+\S/.test(part)) steps.push(part.trim());
    }
  }
  return steps;
}

export function requestCoverageError(promptText: string, nodes: FlowNode[]): string | null {
  const missing: string[] = [];
  const stepLines = extractRequestSteps(promptText);
  const haystacks = nodes.map(nodeHaystack);
  // An app named anywhere in the request (intro or a numbered step) must show
  // up as at least one node; the model otherwise drops it silently (e.g. a
  // manual trigger "simulating" Tiendanube with no Tiendanube step at all).
  for (const [stepRe, nodeRe, name] of APP_MENTIONS) {
    const hit = stepLines.find((l) => stepRe.test(l)) ?? (stepRe.test(promptText) ? promptText : undefined);
    if (hit === undefined) continue;
    if (!haystacks.some((h) => nodeRe.test(h))) {
      missing.push(`${name} ("${hit.trim().slice(0, 80)}")`);
    }
  }
  if (!missing.length) return null;
  const uniq = [...new Set(missing)];
  return `consistencia: the request explicitly asks for ${uniq.join(", ")} but no node uses ${uniq.length === 1 ? "that app" : "those apps"}; add the missing step(s) with the app's plugin or Composio action and wire them in the right position`;
}

/**
 * Channel consistency: when the conversation starts on a messaging-capable app
 * (the trigger's plugin has its own send action), a reply to that conversation
 * must use the SAME app's send action unless the request explicitly names the
 * other channel. Catches "whatsapp/send-message" answering a Mercado Libre buyer
 * when the prompt never mentions WhatsApp.
 */
const MESSAGING_SEND: Record<string, { action: string; aliases: string[]; name: string }> = {
  whatsapp: { action: "whatsapp/send-message", aliases: ["whatsapp"], name: "WhatsApp" },
  mercadolibre: { action: "mercadolibre/send-message", aliases: ["mercado libre", "mercadolibre", "meli"], name: "Mercado Libre" },
  slack: { action: "slack/send-message", aliases: ["slack"], name: "Slack" },
};

/** Per-item intent in the request ("para cada ...", "por cada ...") needs a Loop node. */
export function perItemLoopError(promptText: string, nodes: FlowNode[]): string | null {
  if (!/para cada|por cada/i.test(promptText)) return null;
  if (nodes.some((n) => actionTypeOf(n) === "Loop")) return null;
  return `consistencia: the request processes items one by one ("para cada ...") but the canvas has no Loop node; add a Loop over the list output and put the per-item steps (compare/filter/notify per item) INSIDE it`;
}

/**
 * zipnova/get-shipment takes a shipmentId, which is NOT the order id: it only
 * appears in the ecommerce order DETAIL. A get-shipment with no get-order
 * ancestor can only be fed a hardcoded id.
 */
export function shipmentDetailError(nodes: FlowNode[], edges: FlowEdge[]): string | null {
  const revAdj = new Map<string, string[]>();
  for (const e of edges) {
    if (!revAdj.has(e.target)) revAdj.set(e.target, []);
    (revAdj.get(e.target) as string[]).push(e.source);
  }
  const ancestorsOf = (id: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [...(revAdj.get(id) ?? [])];
    while (queue.length) {
      const c = queue.pop() as string;
      if (seen.has(c)) continue;
      seen.add(c);
      queue.push(...(revAdj.get(c) ?? []));
    }
    return seen;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (actionTypeOf(n) !== "zipnova/get-shipment") continue;
    const ok = [...ancestorsOf(n.id)].some((a) => {
      const t = byId.get(a);
      return t ? /\/get-order$/.test(actionTypeOf(t)) : false;
    });
    if (!ok) {
      const label = n.data?.label ?? n.id;
      return `consistencia: node "${n.id}" (${label}) calls zipnova/get-shipment but no earlier step fetches the order DETAIL; the shipmentId only exists in the order detail output, so add the store's get-order step (e.g. "tiendanube/get-order" or "mercadolibre/get-order") before it and wire shipmentId from there - never hardcode the id`;
    }
  }
  return null;
}

/**
 * Buyer questions need mercadolibre/get-question: search-orders returns orders
 * (summary only), never questions. Catches the model "searching questions" with
 * the orders action.
 */
export function questionActionError(promptText: string, nodes: FlowNode[]): string | null {
  for (const n of nodes) {
    if (actionTypeOf(n) === "mercadolibre/search-orders" && /pregunta/i.test(nodeHaystack(n))) {
      const label = n.data?.label ?? n.id;
      return `consistencia: node "${n.id}" (${label}) uses mercadolibre/search-orders to look for QUESTIONS; search-orders returns orders (summary only), never questions - use "mercadolibre/get-question" instead`;
    }
  }
  const asksQuestions = /(buscar|traer|revisar|listar)[^.;\n]{0,50}pregunta|preguntas?[^.;\n]{0,50}sin responder/i.test(promptText);
  if (asksQuestions && !nodes.some((n) => actionTypeOf(n) === "mercadolibre/get-question")) {
    return `consistencia: the request asks to find unanswered buyer questions but no node uses "mercadolibre/get-question"; add it - mercadolibre/search-orders returns orders, not questions`;
  }
  return null;
}

const CONDITION_ALLOWED_IDENT = new Set(["true", "false", "null", "undefined", "Math", "JSON", "Number", "String", "Boolean", "parseFloat", "parseInt", "Array", "Object", "Date"]);

function bareIdentifiersInCondition(expression: string): string[] {
  // Strip {{@...}} templates, quoted strings, and numbers; what remains must be
  // operators/punctuation only. Any identifier left is an invented variable.
  const stripped = expression
    .replace(/\{\{\@[^}]+\}\}/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ");
  const found = new Set<string>();
  for (const m of stripped.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
    const root = m[0].split(".")[0];
    if (!CONDITION_ALLOWED_IDENT.has(root)) found.add(m[0]);
  }
  return [...found];
}

/**
 * Condition expressions must compare {{@...}} references or fixed values only.
 * An invented variable (orderResult.status, delayed === 'delayed') can never
 * resolve - the executor has no such scope.
 */
/**
 * Fórmula nodes must actually compute something from their declared input.
 * Catches the "ceremonial Fórmula" failure: a constant string expression
 * ("Reconciliación procesada") or an expression that references none of the
 * input's fields. The input is a JSON string that may contain {{@...}}
 * templates; top-level keys are read with a tolerant regex.
 */
export function cyclicFlowError(nodes: FlowNode[], edges: FlowEdge[]): string | null {
  // The runtime executes the flow as a DAG; any directed cycle makes every
  // node in (and downstream of) the cycle unexecutable. Detect one cycle and
  // report the offending edges so the corrective pass can remove them.
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    (adj.get(e.source) as string[]).push(e.target);
  }
  const state = new Map<string, number>(); // 0 unvisited, 1 in-stack, 2 done
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const dfs = (id: string): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const next of adj.get(id) ?? []) {
      const st = state.get(next) ?? 0;
      if (st === 0) {
        if (dfs(next)) return true;
      } else if (st === 1) {
        cycle = stack.slice(stack.indexOf(next)).concat(next);
        return true;
      }
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };
  for (const id of ids) {
    if ((state.get(id) ?? 0) === 0 && dfs(id)) break;
  }
  if (!cycle) return null;
  const path = (cycle as string[])
    .map((id) => `${id} (${nodes.find((n) => n.id === id)?.data?.label ?? id})`)
    .join(" -> ");
  return `estructura: el flujo tiene un CICLO: ${path}. Un workflow es un DAG: cada dato fluye en una sola dirección (listas -> merge/fórmula -> acciones). Quitá las aristas que cierran el ciclo (típicamente una arista que vuelve de un paso posterior hacia un Loop o una lista anterior) y conectá la salida del paso final hacia adelante, nunca hacia atrás`;
}

export function formulaExpressionError(nodes: FlowNode[], itemFields?: Record<string, Record<string, string[]>>): string | null {
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const isListNode = (id: string | undefined): boolean => {
    const n = id ? byId.get(id) : undefined;
    return !!n && LIST_ACTION_RE.test(actionTypeOf(n));
  };
  for (const n of nodes) {
    if (actionTypeOf(n) !== "Fórmula") continue;
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    const label = n.data?.label ?? n.id;
    const input = typeof cfg.input === "string" ? cfg.input : "";
    const expression = typeof cfg.expression === "string" ? cfg.expression.trim() : "";
    if (!input.trim() || !expression) continue; // missing fields are reported elsewhere
    const keys = [...input.matchAll(/"([A-Za-z_]\w*)"\s*:/g)].map((m) => m[1]);
    if (keys.length === 0) continue;
    // Bare string/number literal = computes nothing
    if (/^"[^"]*"$/.test(expression) || /^'[^']*'$/.test(expression) || /^-?\d+(\.\d+)?$/.test(expression)) {
      return `semántica: Fórmula node "${n.id}" (${label}) has a constant expression that computes nothing ("${expression.slice(0, 60)}"); the expression MUST be JSONata that uses the fields declared in its "input" (${keys.join(", ")}) - e.g. filtering, mapping or comparing them. Never use a Fórmula to emit fixed text; write fixed text directly in the step that needs it`;
    }
    // Syntax: compile with the real JSONata engine (catches $@. and friends)
    try {
      jsonata(expression);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `semántica: Fórmula node "${n.id}" (${label}) has invalid JSONata ("${msg.slice(0, 80)}"); fix the expression syntax - valid JSONata uses $ for the current item only inside $map/$filter lambdas (e.g. $filter(pagos, function($p) { $not($p.id in ordenes.id) })), never $@. or invented symbols`;
    }
    const keyUsed = (k: string) => new RegExp(`(^|[^\\w$])\\$?${k}([^\\w$]|$)`).test(expression);
    const usesKey = keys.some(keyUsed);
    if (!usesKey) {
      return `semántica: Fórmula node "${n.id}" (${label}) expression uses none of its "input" fields (${keys.join(", ")}); the JSONata expression MUST reference at least one input field (e.g. ${keys[0]}) so the step actually transforms data`;
    }
    // Anti-projection: an input key bound to a LIST output ({{@node:...}} of a
    // list/search action) exists to be crossed/transformed; an expression that
    // ignores one of them (e.g. just `stripe`) is a no-op projection, not a
    // comparison. Require every list-bound key to be used.
    const listKeys = keys.filter((k) => {
      const m = new RegExp(`"${k}"\\s*:\\s*[^,{]*\\{\\{@([\\w-]+):`).exec(input);
      return m ? isListNode(m[1]) : false;
    });
    const unused = listKeys.filter((k) => !keyUsed(k));
    if (unused.length > 0) {
      return `semántica: Fórmula node "${n.id}" (${label}) declares list input(s) ${unused.map((u) => `"${u}"`).join(", ")} but never uses them in the expression; when a Fórmula receives two lists use the PREBUILT reconcile template verbatim (fill only key/field names): {"soloEnA": $filter(keyA, function($x) { $not($number($x.fieldA) in $map(keyB, function($y){ $number($y.fieldB) })) }), "soloEnB": $filter(keyB, function($y) { $not($number($y.fieldB) in $map(keyA, function($x){ $number($x.fieldA) })) })} (numeric join) - never return one list unchanged`;
    }
    // Join-field existence: for list-bound keys whose source item shape is
    // known, every field the expression reads from that list must exist.
    // Catches invented joins (re15: id/external_reference) the template avoids.
    if (itemFields) {
      for (const k of listKeys) {
        const bind = new RegExp(`"${k}"\\s*:\\s*[^,{]*\\{\\{@([\\w-]+):[^.}]+\\.([\\w[\\]]+)`).exec(input);
        if (!bind) continue;
        const srcNode = byId.get(bind[1]);
        const srcAction = srcNode ? actionTypeOf(srcNode) : "";
        const arrField = (bind[2] ?? "").split("[")[0];
        const shape = itemFields[srcAction]?.[arrField];
        if (!shape || shape.length === 0) continue;
        const bad = new Set<string>();
        for (const dm of expression.matchAll(new RegExp(`(^|[^\\w$])${k}\\.(\\w+)`, "g"))) {
          if (!shape.includes(dm[2])) bad.add(`${k}.${dm[2]}`);
        }
        for (const lm of expression.matchAll(new RegExp(`\\$(?:filter|map)\\(\\s*${k}\\s*,\\s*function\\(\\$(\\w+)\\)\\s*\\{([^}]*)\\}`, "g"))) {
          const v = lm[1];
          const body = lm[2];
          for (const fm of body.matchAll(new RegExp(`\\$${v}\\.(\\w+)`, "g"))) {
            if (!shape.includes(fm[1])) bad.add(`${k}.${fm[1]}`);
          }
        }
        if (bad.size) {
          return `semántica: Fórmula node "${n.id}" (${label}) reads field(s) ${[...bad].map((b) => `"${b}"`).join(", ")} but items from ${srcAction}.${arrField} only have: ${shape.join(", ")}; join the lists on REAL fields present in both (e.g. amount/total with $number(...) normalization) - use the PREBUILT reconcile template verbatim instead of inventing join fields`;
        }
      }
    }
  }
  return null;
}

export function conditionExpressionError(nodes: FlowNode[]): string | null {
  const check = (expression: unknown, where: string): string | null => {
    if (typeof expression !== "string" || !expression.trim()) return null;
    const bare = bareIdentifiersInCondition(expression);
    if (!bare.length) return null;
    return `semántica: ${where} uses invented variable(s) ${bare.map((b) => `"${b}"`).join(", ")}; conditions MUST compare {{@...}} template references or fixed values only (e.g. {{@get-order:Get Order.status}} === 'paid') - the executor has no variable named ${bare[0]}`;
  };
  for (const n of nodes) {
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    const label = n.data?.label ?? n.id;
    if (actionTypeOf(n) === "Condition") {
      const err = check(cfg.condition, `Condition node "${n.id}" (${label})`);
      if (err) return err;
    }
    if (actionTypeOf(n) === "Loop" && Array.isArray(cfg.steps)) {
      for (const st of cfg.steps as Array<{ id?: unknown; actionType?: unknown; config?: unknown }>) {
        if (st?.actionType !== "Condition") continue;
        const sc = (st.config ?? {}) as Record<string, unknown>;
        const err = check(sc.condition, `Loop "${n.id}" inner step "${String(st.id ?? "?")}"`);
        if (err) return err;
      }
    }
  }
  return null;
}

export type SheetColumnsContract = {
  spreadsheetId: string;
  sheets: Array<{ title: string; columns: string[] }>;
};

/**
 * When a source contract was inspected live (lib/source-inspector), Sheets
 * writes against that spreadsheet must use its real sheet names and columns.
 */
export function sheetContractError(nodes: FlowNode[], contracts: SheetColumnsContract[]): string | null {
  if (!contracts.length) return null;
  for (const n of nodes) {
    if (actionTypeOf(n) !== "composio/run-tool") continue;
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    const tool = String(cfg.tool ?? "").toUpperCase();
    if (!tool.startsWith("GOOGLESHEETS")) continue;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(String(cfg.arguments ?? "{}")) as Record<string, unknown>; } catch { args = {}; }
    const sid = String(args.spreadsheet_id ?? "");
    const contract = contracts.find((c) => c.spreadsheetId === sid);
    if (!contract) continue;
    const label = n.data?.label ?? n.id;
    const sheetName = String(args.sheet_name ?? "");
    const sheet = contract.sheets.find((sh) => sh.title === sheetName);
    if (!sheet) {
      return `contrato: node "${n.id}" (${label}) writes to sheet "${sheetName}" but the verified spreadsheet only has: ${contract.sheets.map((sh) => `"${sh.title}"`).join(", ")}; use one of those exact sheet names`;
    }
    if (!sheet.columns.length) continue;
    const values = Array.isArray(args.values) ? (args.values as unknown[]) : null;
    const literalRow = values?.find((row) => {
      const cells = (Array.isArray(row) ? row : [row]).map((c) => String(c ?? ""));
      return cells.some((c) => c.trim() !== "") && cells.every((c) => !c.includes("{{@"));
    });
    if (literalRow) {
      const cells = (Array.isArray(literalRow) ? literalRow : [literalRow]).map((c) => String(c ?? "").trim());
      const same = cells.length === sheet.columns.length && cells.every((c, i) => c.toLowerCase() === sheet.columns[i].toLowerCase());
      if (!same) {
        return `contrato: node "${n.id}" (${label}) writes a literal row (${cells.join(" | ")}) that does not match the verified columns of sheet "${sheet.title}" (${sheet.columns.join(" | ")}); use the exact verified column names and order, and take data values from {{@...}} references`;
      }
    }
  }
  return null;
}

/**
 * An HTTP Request node can carry config.responseSchema: a sample JSON the user
 * pasted for their own API. References into that node's .data output must
 * resolve against the sample's real shape.
 */
export function httpSchemaError(nodes: FlowNode[]): string | null {
  const samples = new Map<string, { label: string; paths: Set<string> }>();
  for (const n of nodes) {
    if (actionTypeOf(n) !== "HTTP Request") continue;
    const raw = (n.data?.config as Record<string, unknown> | undefined)?.responseSchema;
    if (!raw) continue;
    let sample: unknown;
    try { sample = JSON.parse(String(raw)); } catch { continue; }
    if (!sample || typeof sample !== "object") continue;
    const paths = new Set<string>();
    const walk = (v: unknown, prefix: string, depth: number): void => {
      if (depth > 4 || v === null || typeof v !== "object") return;
      const entries = Array.isArray(v) ? Object.entries((v[0] ?? {}) as Record<string, unknown>) : Object.entries(v as Record<string, unknown>);
      for (const [k, val] of entries) {
        const p = prefix ? `${prefix}.${k}` : k;
        paths.add(p);
        if (val && typeof val === "object") walk(val, p, depth + 1);
      }
    };
    walk(sample, "", 0);
    if (paths.size) samples.set(n.id, { label: n.data?.label ?? n.id, paths });
  }
  if (!samples.size) return null;
  for (const n of nodes) {
    const txt = JSON.stringify(n.data?.config ?? {});
    for (const m of txt.matchAll(/\{\{@([\w-]+):[^}]*?\.data\.([\w.\[\]]+)\}\}/g)) {
      const sample = samples.get(m[1]);
      if (!sample) continue;
      const refPath = m[2].replace(/\[\d+\]/g, "");
      const known = sample.paths.has(refPath) || [...sample.paths].some((p) => p.startsWith(`${refPath}.`));
      if (refPath && !known) {
        return `contrato: node "${n.id}" (${n.data?.label ?? n.id}) references "${m[1]}.data.${m[2]}" but the sample response of "${sample.label}" only has: ${[...sample.paths].slice(0, 12).join(", ")}; reference a field that actually exists in the API's response`;
      }
    }
  }
  return null;
}

const LIST_ACTION_RE = /search-|list-|get-question/;

/**
 * Crossing two lists (reconciliation, "detect cobros sin orden") is a
 * deterministic join: Loop over one list with inner compare steps, or a
 * Fórmula. An AI text node reading both raw lists cannot do it reliably.
 */
export function listCrossingError(promptText: string, nodes: FlowNode[]): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isList = (n: FlowNode | undefined): boolean => !!n && LIST_ACTION_RE.test(actionTypeOf(n));
  for (const n of nodes) {
    if (actionTypeOf(n) !== "ai-gateway/generate-text") continue;
    const txt = JSON.stringify(n.data?.config ?? {});
    const refs = new Set([...txt.matchAll(/\{\{@([\w-]+):/g)].map((m) => m[1]));
    const listRefs = [...refs].filter((id) => isList(byId.get(id)));
    if (listRefs.length >= 2) {
      const label = n.data?.label ?? n.id;
      return `consistencia: node "${n.id}" (${label}) crosses TWO list outputs in an AI text node; crossing lists MUST be deterministic: a Loop over one list whose inner steps look up / compare each element against the other list (Condition/Fórmula inside the Loop), or a single Fórmula joining both - not LLM prose over serialized lists`;
    }
  }
  const wantsCross = /compar|cruz|reconcil|sin orden|sin cobro|sin pago|diferenc/i.test(promptText);
  if (!wantsCross) return null;
  const listNodes = nodes.filter((n) => isList(n));
  if (listNodes.length < 2) return null;
  // Accepted deterministic crossings:
  // (a) ONE Fórmula whose "input" references TWO OR MORE distinct list outputs
  //     (JSONata filters/maps over both - the canonical reconciliation shape);
  // (b) a Loop over one list whose inner steps consult the OTHER list: a
  //     template ref to another list node, or an inner list action keyed by
  //     {{@item:...}} (per-item lookup).
  // A cross Fórmula must bind the ARRAY output of each list (payments/orders/
  // items), not a scalar (count/hasMore) or one indexed element: crossing
  // counts or first items computes nothing per-item.
  const SCALAR_OUTPUT_RE = /^(count|hasMore|has_more|total|totalCount|total_count|page|pages|limit|offset|size|nextCursor|next_cursor|cursor)$/i;
  let scalarBinding: { id: string; label: string; field: string } | null = null;
  const hasCrossFormula = nodes.some((n) => {
    if (actionTypeOf(n) !== "Fórmula") return false;
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    const input = typeof cfg.input === "string" ? cfg.input : "";
    const refs = [...input.matchAll(/\{\{@([\w-]+):[^}]*?\.([\w.\[\]]+)\}\}/g)]
      .map((m) => ({ id: m[1], field: m[2] }))
      .filter((r) => isList(byId.get(r.id)));
    if (new Set(refs.map((r) => r.id)).size < 2) return false;
    for (const r of refs) {
      const leaf = r.field.split(".").pop() ?? r.field;
      if (SCALAR_OUTPUT_RE.test(leaf) || /\[\d+\]/.test(r.field)) {
        scalarBinding = { id: n.id, label: n.data?.label ?? n.id, field: `${r.id}.${r.field}` };
        return false;
      }
    }
    return true;
  });
  if (scalarBinding) {
    const b = scalarBinding as { id: string; label: string; field: string };
    return `semántica: Fórmula node "${b.id}" (${b.label}) binds "${b.field}", a scalar/indexed output; to CROSS two lists the "input" MUST bind each list's ARRAY output (e.g. {"pagos": {{@stripe:....payments}}, "ordenes": {{@tienda:....orders}}}) and the expression MUST be the PREBUILT reconcile template ({"soloEnA": $filter(keyA, ...), "soloEnB": $filter(keyB, ...)} with $number($x.fieldA) in $map(keyB, ...) for numeric joins) - comparing counts or single items is not a reconciliation`;
  }
  if (hasCrossFormula) return null;
  const hasCrossLoop = nodes.some((n) => {
    if (actionTypeOf(n) !== "Loop") return false;
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    const sourceRef = /\{\{@([\w-]+):/.exec(typeof cfg.source === "string" ? cfg.source : "")?.[1];
    const steps = Array.isArray(cfg.steps) ? (cfg.steps as Array<Record<string, unknown>>) : [];
    const stepsJson = JSON.stringify(steps);
    const refs = new Set([...stepsJson.matchAll(/\{\{@([\w-]+):/g)].map((m) => m[1]));
    for (const id of refs) {
      if (id !== "item" && id !== "index" && id !== sourceRef && isList(byId.get(id))) return true;
    }
    // per-item lookup: an inner list action keyed by the current item
    return steps.some(
      (st) =>
        typeof st?.actionType === "string" &&
        LIST_ACTION_RE.test(st.actionType as string) &&
        JSON.stringify(st.config ?? {}).includes("{{@item:")
    );
  });
  if (hasCrossLoop) return null;
  return `consistencia: the request asks to compare/cross two lists but no step actually crosses them. Use ONE Fórmula whose "input" JSON includes BOTH list outputs (e.g. {"pagos": {{@a:A.payments}}, "ordenes": {{@b:B.orders}}}) with a JSONata expression that filters/maps one against the other ($filter, $map, $contains), OR a Loop over one list whose inner steps look each item up in the other list (an inner Search/List action keyed by {{@item:Item.id}} plus a Condition). Loops that only read their own items and AI text steps do NOT cross lists`;
}

export function channelConsistencyError(promptText: string, nodes: FlowNode[]): string | null {
  const prompt = promptText.toLowerCase();
  const trigger = nodes.find(isTrigger);
  if (!trigger) return null;
  const tCfg = (trigger.data?.config ?? {}) as Record<string, unknown>;
  const tApp = String(tCfg.triggerType ?? "").split("/")[0];
  const tMessaging = MESSAGING_SEND[tApp];
  if (!tMessaging) return null;
  const senders: Array<{ id: string; label: string; actionType: string }> = [];
  for (const n of nodes) {
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    const at = String(cfg.actionType ?? "");
    if (at) senders.push({ id: n.id, label: n.data?.label ?? "", actionType: at });
    const steps = Array.isArray(cfg.steps) ? (cfg.steps as Array<{ id?: string; actionType?: string }>) : [];
    for (const s of steps) if (s?.actionType) senders.push({ id: `${n.id}/${s.id ?? "?"}`, label: n.data?.label ?? "", actionType: String(s.actionType) });
  }
  for (const s of senders) {
    const app = s.actionType.split("/")[0];
    if (app === tApp) continue;
    const m = MESSAGING_SEND[app];
    if (!m || s.actionType !== m.action) continue;
    if (m.aliases.some((a) => prompt.includes(a))) continue;
    return `consistencia: node "${s.id}" (${s.label}) sends via ${m.action} but the request never mentions ${m.name} and the conversation starts on ${tMessaging.name}; to reply in the SAME channel use "${tMessaging.action}". Use ${m.action} only when the user explicitly asks for that channel`;
  }
  return null;
}


/**
 * unwiredReportStepError: a final/report step (Sheets append/update, Gmail or
 * Slack send) whose config carries NO {{@...}} data reference at all, while an
 * earlier data-producing step exists. Catches the re13/re14 shape: the Fórmula
 * computes the differences and the report steps send static text instead.
 * {{@item:...}} refs (inside Loops) count as wiring.
 */
const REPORT_COMPOSIO_TOOL_RE = /^(?:GOOGLESHEETS_\w*(?:APPEND|UPDATE)|GMAIL_\w*SEND|SLACK_\w*(?:SEND|POST))/;
const REPORT_PLUGIN_ACTION_RE = /^(?:googlesheets|gmail|slack)[/-]\w*(?:send|append|update|post)/i;
const REPORT_CONTROL_ACTIONS = new Set(["Condition", "Delay", "Approval"]);

export function unwiredReportStepError(nodes: FlowNode[], edges: FlowEdge[]): string | null {
  const byId = new Map<string, FlowNode>();
  for (const n of nodes) byId.set(n.id, n);
  const revAdj = new Map<string, string[]>();
  for (const e of edges) {
    if (!revAdj.has(e.target)) revAdj.set(e.target, []);
    (revAdj.get(e.target) as string[]).push(e.source);
  }
  const ancestorsOf = (id: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [...(revAdj.get(id) ?? [])];
    while (queue.length) {
      const c = queue.pop() as string;
      if (seen.has(c)) continue;
      seen.add(c);
      queue.push(...(revAdj.get(c) ?? []));
    }
    return seen;
  };
  const errors: string[] = [];
  for (const n of nodes) {
    if (isTrigger(n)) continue;
    const cfg = n.data?.config ?? {};
    const tool = typeof cfg.tool === "string" ? cfg.tool : "";
    const at = actionTypeOf(n);
    if (!REPORT_COMPOSIO_TOOL_RE.test(tool) && !REPORT_PLUGIN_ACTION_RE.test(at)) continue;
    const strings: Array<{ path: string; value: string }> = [];
    collectStrings(cfg, "", strings);
    const hasRef = strings.some(({ value }) => {
      TEMPLATE_RE.lastIndex = 0;
      return TEMPLATE_RE.test(value);
    });
    if (hasRef) continue;
    const hasDataAncestor = [...ancestorsOf(n.id)].some((id) => {
      const a = byId.get(id);
      return !!a && !isTrigger(a) && !REPORT_CONTROL_ACTIONS.has(actionTypeOf(a));
    });
    if (!hasDataAncestor) continue;
    const label = n.data?.label ?? n.id;
    errors.push(`semántica: final step "${n.id}" (${label}) sends/writes STATIC text with no {{@...}} reference, but earlier steps already produce the data it should report - wire the real data in (e.g. {{@<node-id>:<Label>.result}} or fields of the earlier lists), never a fixed summary`);
  }
  return errors.length ? errors.join("\n") : null;
}
