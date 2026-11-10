const dataActions = new Set([
  "Datos",
  "Comparar Stock",
  "Conciliar Pagos",
  "Revisar Envíos",
  "Alertas de Stock",
  "Preparar Avisos",
  "Preparar Respuestas",
]);
export function needsConsoleData(nodes: unknown) {
  return (
    Array.isArray(nodes) &&
    nodes.some((n) => dataActions.has(n?.data?.config?.actionType))
  );
}
export function consoleDataScope(
  organizationId: string,
  ctx: { organizationId: string; memberRole: string | null } | null
) {
  if (!ctx || ctx.organizationId !== organizationId) {
    return null;
  }
  return {
    dataOrganizationId: ctx.organizationId,
    dataCanDefineFields:
      ctx.memberRole === "owner" || ctx.memberRole === "admin",
  };
}
