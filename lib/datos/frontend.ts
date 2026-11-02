/**
 * Frontend node (prototype): a presentation node. It does not change the flow;
 * its config defines ONE basic page per workflow: a title, an optional manual
 * "Ejecutar" button and a table of ONE Datos collection (polled, not realtime).
 * Pure helpers (no server-only) so they can be tested offline.
 */
export type FrontendView = { title: string; collection: string; showRun: boolean };

const COLLECTION_RE = /^[a-z0-9_]{1,40}$/;

type NodeLike = { data?: { config?: Record<string, unknown> } };

/** Read the Frontend node from the SERVER copy of the workflow. Null if none or invalid. */
export function frontendViewFromNodes(nodes: unknown): FrontendView | null {
  if (!Array.isArray(nodes)) return null;
  const n = (nodes as NodeLike[]).find((x) => x?.data?.config?.actionType === "Frontend");
  if (!n) return null;
  const c = n.data?.config ?? {};
  const collection = typeof c.collection === "string" ? c.collection.trim() : "";
  if (!COLLECTION_RE.test(collection)) return null;
  const title = typeof c.title === "string" && c.title.trim() ? c.title.trim().slice(0, 80) : "Panel";
  return { title, collection, showRun: c.showRun !== "false" && c.showRun !== false };
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
  if (!f.signedIn || f.anonymous || !f.workflowExists) return null;
  if (!f.isOwner && !f.hasShare) return null;
  if (!f.scopeOrganizationId || !f.isMemberOfScopeOrg) return null;
  return f.scopeOrganizationId;
}

export type FrontendRunDecision = { ok: true; organizationId: string } | { ok: false; status: 401 | 403 | 404; reason: string };

/**
 * Authorization for running a workflow FROM its Frontend page. Same server
 * checks as reading (session, owner/share, org scope, org membership), plus:
 * the workflow must have a valid Frontend node with the Ejecutar button on,
 * and the request must come from the same origin. Nothing from the request
 * body takes part in the decision.
 */
export function authorizeFrontendRun(input: { facts: AccessFacts; nodes: unknown; requestOrigin: string | null; urlOrigin: string }): FrontendRunDecision {
  if (!input.facts.signedIn || input.facts.anonymous) return { ok: false, status: 401, reason: "Iniciá sesión." };
  if (input.requestOrigin !== input.urlOrigin) return { ok: false, status: 403, reason: "Origen no permitido." };
  const organizationId = decideWorkflowOrg(input.facts);
  if (!organizationId) return { ok: false, status: 403, reason: "Sin acceso a este workflow." };
  const view = frontendViewFromNodes(input.nodes);
  if (!view || !view.showRun) return { ok: false, status: 404, reason: "Esta página no tiene botón Ejecutar." };
  return { ok: true, organizationId };
}
