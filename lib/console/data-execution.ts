import "server-only";
import { orgForWorkflowRead } from "@/lib/datos/access";
import { datosEnabled } from "@/lib/datos/core";
import { consoleDataScope, needsConsoleData } from "./data-execution-policy";
export async function consoleDataExecution(
  request: Request,
  workflowId: string,
  organizationId: string,
  nodes: unknown
) {
  if (!needsConsoleData(nodes)) {
    return {};
  }
  const ctx = datosEnabled()
    ? await orgForWorkflowRead(request, workflowId)
    : null;
  return consoleDataScope(organizationId, ctx);
}
