import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutionLogs, workflowExecutions } from "@/lib/db/schema";
import {
  integrationFromActionType,
  type solutionConfigFromNodes,
} from "@/lib/soluciones/config";
import {
  type FuenteOutcome,
  type FuenteView,
  fuentesView,
} from "@/lib/soluciones/fuentes-view";
import { redactSensitiveData } from "@/lib/utils/redact";
import { getIntegrationLabels } from "@/plugins/registry";
/** Estados visibles de las fuentes declaradas, a partir del último run. */
export async function sourcesViewForWorkflow(
  workflowId: string,
  solution: ReturnType<typeof solutionConfigFromNodes>
): Promise<FuenteView[] | undefined> {
  if (!solution || Object.keys(solution.sources).length === 0) {
    return;
  }
  const lastExecution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.workflowId, workflowId),
    orderBy: [desc(workflowExecutions.startedAt)],
  });
  const logs = lastExecution
    ? await db.query.workflowExecutionLogs.findMany({
        where: eq(workflowExecutionLogs.executionId, lastExecution.id),
        orderBy: [desc(workflowExecutionLogs.timestamp)],
      })
    : [];
  const outcomeFor = (integration: string): FuenteOutcome => {
    const log = logs.find(
      (l) => integrationFromActionType(l.nodeType) === integration
    );
    if (!log) {
      return null;
    }
    if (log.status === "success") {
      return { status: "success", at: log.timestamp.toISOString() };
    }
    return {
      status: "error",
      error: redactSensitiveData(log.error || ""),
      at: log.timestamp.toISOString(),
    };
  };
  return fuentesView(solution, outcomeFor, getIntegrationLabels());
}
