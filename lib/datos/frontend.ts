/**
 * Frontend node (prototype): a presentation node. It does not change the flow;
 * its config defines ONE basic page per workflow: a title, an optional manual
 * "Ejecutar" button and a table of ONE Datos collection (polled, not realtime).
 * Pure helpers (no server-only) so they can be tested offline.
 */
export type PanelAction = { id: string; label: string };

/** Content blocks of the panel whose order/composition the config declares. */
export const PANEL_BLOCK_KEYS = ["fuentes", "formulario", "tabla"] as const;
export type PanelBlockKey = (typeof PANEL_BLOCK_KEYS)[number];
export const DEFAULT_PANEL_BLOCKS: PanelBlockKey[] = [
  "fuentes",
  "formulario",
  "tabla",
];
export const MAX_ACTIONS = 4;

export type FrontendView = {
  title: string;
  collection: string;
  showRun: boolean;
  /** Fields of the stored value to show as table columns. Empty = the basic Clave / Valor / Actualizado table. */
  columns: string[];
  /** Show a form built from the collection's defined fields (needs fields defined in Datos). */
  showForm: boolean;
  /** Field whose value becomes the record key. Empty = automatic id. */
  keyField: string;
  /** After saving from the form, also run this workflow with the validated values as input. */
  runOnSubmit: boolean;
  /** Order of the content blocks declared by the case. Default keeps the original composition. */
  blocks: PanelBlockKey[];
  /** Row actions of the case: each writes actionField=<id> on the record. */
  actions: PanelAction[];
  /** Field each action sets on the record (default "estado"). */
  actionField: string;
  rowsField?: string;
  labels?: Record<string, string>;
};
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const MAX_COLUMNS = 12;

const COLLECTION_RE = /^[a-z0-9_]{1,40}$/;

type NodeLike = { data?: { config?: Record<string, unknown> } };

/** A field name from config, or the fallback when missing/invalid. */
function parseFieldName(value: unknown, fallback: string): string {
  return typeof value === "string" && FIELD_NAME_RE.test(value.trim())
    ? value.trim()
    : fallback;
}

/** Column list from config: "a, b, c" deduped, valid field names only, capped. */
function parseColumns(c: Record<string, unknown>): string[] {
  if (typeof c.columns !== "string") {
    return [];
  }
  return [
    ...new Set(
      c.columns
        .split(",")
        .map((x) => x.trim())
        .filter((x) => FIELD_NAME_RE.test(x))
    ),
  ].slice(0, MAX_COLUMNS);
}

/** Optional display labels: "campo=Etiqueta, otro=Otra". Labels are free text rendered as table headers (React escapes them). */
function parseLabels(c: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {};
  if (typeof c.labels !== "string") {
    return labels;
  }
  for (const pair of c.labels.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 1) {
      continue;
    }
    const field = pair.slice(0, eqIdx).trim();
    const label = pair
      .slice(eqIdx + 1)
      .trim()
      .slice(0, 40);
    if (FIELD_NAME_RE.test(field) && label) {
      labels[field] = label;
    }
  }
  return labels;
}

/** Optional content block order/composition: "tabla, formulario, fuentes". Unknown keys are ignored; an empty result falls back to the default order, so existing panels never change without an explicit config. */
function parseBlocks(c: Record<string, unknown>): PanelBlockKey[] {
  if (typeof c.blocks !== "string" || !c.blocks.trim()) {
    return DEFAULT_PANEL_BLOCKS;
  }
  const seen = new Set<PanelBlockKey>();
  for (const raw of c.blocks.split(",")) {
    const key = raw.trim();
    if (
      (PANEL_BLOCK_KEYS as readonly string[]).includes(key) &&
      !seen.has(key as PanelBlockKey)
    ) {
      seen.add(key as PanelBlockKey);
    }
  }
  return seen.size > 0 ? [...seen] : DEFAULT_PANEL_BLOCKS;
}

/** Optional row actions of the case: "aprobar=Aprobar, derivar=Derivar a soporte". Each action sets actionField=<id> on the record of its row (id validated as a field name). */
function parseActions(c: Record<string, unknown>): PanelAction[] {
  const actions: PanelAction[] = [];
  if (typeof c.actions !== "string") {
    return actions;
  }
  for (const pair of c.actions.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 1) {
      continue;
    }
    const id = pair.slice(0, eqIdx).trim();
    const label = pair
      .slice(eqIdx + 1)
      .trim()
      .slice(0, 40);
    if (FIELD_NAME_RE.test(id) && label && !actions.some((a) => a.id === id)) {
      actions.push({ id, label });
    }
    if (actions.length >= MAX_ACTIONS) {
      break;
    }
  }
  return actions;
}

/** Read the Frontend node from the SERVER copy of the workflow. Null if none or invalid. */
export function frontendViewFromNodes(nodes: unknown): FrontendView | null {
  if (!Array.isArray(nodes)) {
    return null;
  }
  const n = (nodes as NodeLike[]).find(
    (x) => x?.data?.config?.actionType === "Frontend"
  );
  if (!n) {
    return null;
  }
  const c = n.data?.config ?? {};
  const collection =
    typeof c.collection === "string" ? c.collection.trim() : "";
  if (!COLLECTION_RE.test(collection)) {
    return null;
  }
  const title =
    typeof c.title === "string" && c.title.trim()
      ? c.title.trim().slice(0, 80)
      : "Panel";
  const columns = parseColumns(c);
  const keyField = parseFieldName(c.keyField, "");
  const showForm = c.showForm === "true" || c.showForm === true;
  // Optional: render the array stored at value[rowsField] of the latest record
  // as the table (single-record reports), instead of one row per record.
  const rowsField = parseFieldName(c.rowsField, "");
  const labels = parseLabels(c);
  const blocks = parseBlocks(c);
  const actions = parseActions(c);
  const actionField = parseFieldName(c.actionField, "estado");
  return {
    title,
    collection,
    showRun: c.showRun !== "false" && c.showRun !== false,
    columns,
    showForm,
    keyField,
    rowsField,
    labels,
    runOnSubmit:
      showForm && (c.runOnSubmit === "true" || c.runOnSubmit === true),
    blocks,
    actions,
    actionField,
  };
}

/** Only organization owners and admins may define or change the fields of a collection. */
export function canDefineDatosFields(role: unknown): boolean {
  return role === "owner" || role === "admin";
}

export type AccessFacts = {
  signedIn: boolean;
  anonymous: boolean;
  workflowExists: boolean;
  isOwner: boolean;
  hasShare: boolean;
  scopeOrganizationId: string | null;
  isMemberOfScopeOrg: boolean;
};

/** Closed by default: every condition must hold. Returns the organization or null. */
export function decideWorkflowOrg(f: AccessFacts): string | null {
  if (!f.signedIn || f.anonymous || !f.workflowExists) {
    return null;
  }
  if (!(f.isOwner || f.hasShare)) {
    return null;
  }
  if (!(f.scopeOrganizationId && f.isMemberOfScopeOrg)) {
    return null;
  }
  return f.scopeOrganizationId;
}

export type FrontendRunDecision =
  | { ok: true; organizationId: string }
  | { ok: false; status: 401 | 403 | 404; reason: string };

/**
 * Authorization for running a workflow FROM its Frontend page. Same server
 * checks as reading (session, owner/share, org scope, org membership), plus:
 * the workflow must have a valid Frontend node with the Ejecutar button on,
 * and the request must come from the same origin. Nothing from the request
 * body takes part in the decision.
 */
export function authorizeFrontendRun(input: {
  facts: AccessFacts;
  nodes: unknown;
  requestOrigin: string | null;
  urlOrigin: string;
}): FrontendRunDecision {
  if (!input.facts.signedIn || input.facts.anonymous) {
    return { ok: false, status: 401, reason: "Iniciá sesión." };
  }
  if (input.requestOrigin !== input.urlOrigin) {
    return { ok: false, status: 403, reason: "Origen no permitido." };
  }
  const organizationId = decideWorkflowOrg(input.facts);
  if (!organizationId) {
    return { ok: false, status: 403, reason: "Sin acceso a este workflow." };
  }
  const view = frontendViewFromNodes(input.nodes);
  if (!view?.showRun) {
    return {
      ok: false,
      status: 404,
      reason: "Esta página no tiene botón Ejecutar.",
    };
  }
  return { ok: true, organizationId };
}

export type FrontendSubmitDecision =
  | { ok: true; organizationId: string }
  | { ok: false; status: 401 | 403 | 404; reason: string };

/** Authorization for sending the form of a Frontend page: same server checks as run, but the form must be on. */
export function authorizeFrontendSubmit(input: {
  facts: AccessFacts;
  nodes: unknown;
  requestOrigin: string | null;
  urlOrigin: string;
}): FrontendSubmitDecision {
  if (!input.facts.signedIn || input.facts.anonymous) {
    return { ok: false, status: 401, reason: "Iniciá sesión." };
  }
  if (input.requestOrigin !== input.urlOrigin) {
    return { ok: false, status: 403, reason: "Origen no permitido." };
  }
  const organizationId = decideWorkflowOrg(input.facts);
  if (!organizationId) {
    return { ok: false, status: 403, reason: "Sin acceso a este workflow." };
  }
  const view = frontendViewFromNodes(input.nodes);
  if (!view?.showForm) {
    return {
      ok: false,
      status: 404,
      reason: "Esta página no tiene formulario.",
    };
  }
  return { ok: true, organizationId };
}

/** Authorization for running a row ACTION of a Frontend page: same server checks as submit, but the page must declare actions. */
export function authorizeFrontendAction(input: {
  facts: AccessFacts;
  nodes: unknown;
  requestOrigin: string | null;
  urlOrigin: string;
}): FrontendSubmitDecision {
  if (!input.facts.signedIn || input.facts.anonymous) {
    return { ok: false, status: 401, reason: "Iniciá sesión." };
  }
  if (input.requestOrigin !== input.urlOrigin) {
    return { ok: false, status: 403, reason: "Origen no permitido." };
  }
  const organizationId = decideWorkflowOrg(input.facts);
  if (!organizationId) {
    return { ok: false, status: 403, reason: "Sin acceso a este workflow." };
  }
  const view = frontendViewFromNodes(input.nodes);
  if (!view || view.actions.length === 0) {
    return { ok: false, status: 404, reason: "Esta página no tiene acciones." };
  }
  return { ok: true, organizationId };
}
