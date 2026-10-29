export const roles = ["owner", "admin", "manager", "operator"] as const;
export type ConsoleRole = (typeof roles)[number];
export type ConsoleGrant = {
  userId: string;
  organizationId: string;
  role: ConsoleRole;
  teamIds: string[];
  workflowIds: string[];
  canRun: boolean;
};
// A separate, explicit grant namespace keeps builder membership from implicitly granting console access.
export function parseGrant(
  metadata: string | null,
  userId: string,
  organizationId: string,
): ConsoleGrant | null {
  try {
    const value = JSON.parse(metadata || "{}");
    const raw = value.organizations?.[organizationId]?.users?.[userId];
    if (
      !raw ||
      !roles.includes(raw.role) ||
      typeof raw.canRun !== "boolean" ||
      !Array.isArray(raw.teamIds) ||
      !Array.isArray(raw.workflowIds) ||
      [...raw.teamIds, ...raw.workflowIds].some((x) => typeof x !== "string")
    )
      return null;
    return {
      userId,
      organizationId,
      role: raw.role,
      teamIds: raw.teamIds,
      workflowIds: raw.workflowIds,
      canRun: raw.canRun,
    };
  } catch {
    return null;
  }
}
export type Assignment = {
  organizationId: string;
  workflowId: string;
  teamId: string | null;
};
export function canView(grant: ConsoleGrant, assignment: Assignment) {
  if (grant.organizationId !== assignment.organizationId) return false;
  if (grant.role === "owner" || grant.role === "admin") return true;
  if (grant.role === "manager")
    return !!assignment.teamId && grant.teamIds.includes(assignment.teamId);
  return grant.workflowIds.includes(assignment.workflowId);
}
export function canExecute(
  grant: ConsoleGrant,
  assignment: Assignment,
  manual: boolean,
  active: boolean,
) {
  return canView(grant, assignment) && grant.canRun && manual && active;
}
export function safeError() {
  return "No se pudo completar la operación. Contactá a tu administrador.";
}

export function canManageGrant(
  actor: ConsoleGrant,
  current: ConsoleGrant | null,
  next: ConsoleGrant,
) {
  if (
    actor.organizationId !== next.organizationId ||
    actor.userId === next.userId ||
    (current?.organizationId &&
      current.organizationId !== actor.organizationId) ||
    current?.role === "owner" ||
    next.role === "owner"
  )
    return false;
  if (actor.role === "owner") return true;
  if (actor.role === "admin")
    return (
      (!current || !["owner", "admin"].includes(current.role)) &&
      ["manager", "operator"].includes(next.role)
    );
  if (
    actor.role !== "manager" ||
    next.role !== "operator" ||
    (current && current.role !== "operator")
  )
    return false;
  const inTeams = (grant: ConsoleGrant) =>
    grant.teamIds.length > 0 &&
    grant.teamIds.every((t) => actor.teamIds.includes(t));
  return (
    inTeams(next) &&
    (!current || inTeams(current)) &&
    (!next.canRun || actor.canRun)
  );
}
