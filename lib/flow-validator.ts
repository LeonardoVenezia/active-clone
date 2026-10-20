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
];

const SYSTEM_OUTPUTS: OutputsMap = {
  Loop: ["results", "items", "failed", "count", "completed", "failedCount"],
  Fórmula: ["result"],
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

export function validateFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  actionOutputs: OutputsMap = {},
  validActionTypes?: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  const byId = new Map<string, FlowNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) errors.push(`grafo: duplicate node id "${n.id}" added twice`);
    byId.set(n.id, n);
  }

  const triggers = nodes.filter(isTrigger);
  if (triggers.length === 0) errors.push("grafo: the workflow has no trigger node");
  if (triggers.length > 1) errors.push(`grafo: ${triggers.length} trigger nodes; exactly one is required`);

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
      }
    }

    // Placeholders + template reference integrity (recurses into Loop inner steps)
    const strings: Array<{ path: string; value: string }> = [];
    collectStrings(cfg, "", strings);
    for (const { path, value } of strings) {
      for (const re of PLACEHOLDER_RES) {
        if (re.test(value)) {
          errors.push(`consistencia: node "${n.id}" (${label}) field "${path}" looks like a placeholder ("${value.slice(0, 60)}"); use a real value or a {{@...}} reference`);
          break;
        }
      }
      for (const match of value.matchAll(TEMPLATE_RE)) {
        const refId = match[1];
        if (refId === "item" || refId === "index") continue;
        const target = byId.get(refId);
        if (!target) {
          errors.push(`grafo: node "${n.id}" (${label}) field "${path}" references node "${refId}" which was never added`);
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
        const known = outputsOf(actionTypeOf(target));
        if (known && firstField && !known.includes(firstField)) {
          errors.push(`semántica: node "${n.id}" (${label}) references "${refId}.${firstField}" but ${actionTypeOf(target)} only outputs: ${known.join(", ")}`);
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
