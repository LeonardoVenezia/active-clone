import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { orgForWorkflowRead } from "@/lib/datos/access";
import { datosEnabled, datosGetFields, datosList } from "@/lib/datos/core";
import { frontendViewFromNodes } from "@/lib/datos/frontend";
import { pgDatosRepo } from "@/lib/datos/repo";
import { db } from "@/lib/db";
import { workflowExecutionLogs, workflowExecutions } from "@/lib/db/schema";
import {
  integrationFromActionType,
  solutionConfigFromNodes,
} from "@/lib/soluciones/config";
import {
  type FuenteOutcome,
  type FuenteView,
  fuentesView,
} from "@/lib/soluciones/fuentes-view";
import { redactSensitiveData } from "@/lib/utils/redact";
import { getIntegrationLabels } from "@/plugins/registry";

// Read-only data for the Frontend page of ONE workflow. Query: workflowId only.
// Organization and collection both come from the server copy of the workflow
// (scope + Frontend node config); nothing else in the request can choose them.
export async function GET(request: Request) {
  if (!datosEnabled()) {
    return NextResponse.json({ enabled: false, records: [] });
  }
  try {
    const workflowId =
      new URL(request.url).searchParams.get("workflowId") || "";
    const ctx = workflowId
      ? await orgForWorkflowRead(request, workflowId)
      : null;
    if (!ctx) {
      return NextResponse.json(
        { error: "Sin acceso a los datos de esta empresa." },
        { status: 403 }
      );
    }
    const view = frontendViewFromNodes(ctx.nodes);
    // Slots declarativos de diseño de la solución (nodo "Solución", servidor).
    const solution = solutionConfigFromNodes(ctx.nodes);
    if (!view) {
      return NextResponse.json(
        {
          error:
            "Este workflow no tiene un nodo Frontend válido. Revisá que exista y que la colección use solo minúsculas, números y guion bajo (_).",
        },
        { status: 404 }
      );
    }
    const result = await datosList(pgDatosRepo, ctx.organizationId, {
      collection: view.collection,
      limit: 50,
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const fields = view.showForm
      ? await datosGetFields(pgDatosRepo, ctx.organizationId, view.collection)
      : null;
    const viewWithSlots = solution?.frontend
      ? { ...view, solution: solution.frontend }
      : view;
    // Fuentes de la solución con su estado visible (desactivada / sin datos /
    // error / al día), derivado de la config y del último run: el panel del
    // cliente nunca muestra un vacío ambiguo como si fuera éxito.
    const sources = await sourcesViewForWorkflow(workflowId, solution);
    return NextResponse.json(
      {
        enabled: true,
        view: viewWithSlots,
        canRun: true,
        fields,
        records: result.records,
        ...(sources ? { sources } : {}),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar los datos." },
      { status: 503 }
    );
  }
}

/** Estados visibles de las fuentes declaradas, a partir del último run. */
async function sourcesViewForWorkflow(
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
      return { status: "success" };
    }
    return {
      status: "error",
      error: redactSensitiveData(log.error || ""),
    };
  };
  return fuentesView(solution, outcomeFor, getIntegrationLabels());
}
