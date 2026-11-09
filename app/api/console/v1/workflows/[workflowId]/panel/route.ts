import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { consoleContext } from "@/lib/console/context";
import { runtimeAssignments, visibleWorkflows } from "@/lib/console/data";
import { consolePanelDecision } from "@/lib/console/panel";
import { managementWorkflowScopes } from "@/lib/console/schema";
import { datosEnabled, datosList } from "@/lib/datos/core";
import { pgDatosRepo } from "@/lib/datos/repo";
import { db } from "@/lib/db";
import { sourcesViewForWorkflow } from "@/lib/soluciones/workflow-sources";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    const { workflowId } = await params;
    const flow =
      (await visibleWorkflows(ctx.grant, ctx.organization.metadata)).find(
        (x) => x.id === workflowId
      ) || null;
    const assignment =
      (await runtimeAssignments()).find(
        (x) =>
          x.organizationId === ctx.grant.organizationId &&
          x.workflowId === workflowId
      ) || null;
    const [scope] = flow
      ? await db
          .select({ organizationId: managementWorkflowScopes.organizationId })
          .from(managementWorkflowScopes)
          .where(eq(managementWorkflowScopes.workflowId, workflowId))
      : [];
    const decision = consolePanelDecision({
      grant: ctx.grant,
      flow,
      assignment,
      dataOrganizationId: scope?.organizationId || null,
      dataEnabled: datosEnabled(),
      executionEnabled: process.env.CONSOLE_EXECUTION_ENABLED === "true",
    });
    if (decision.status !== 200) {
      const errors: Record<number, string> = {
        401: "No autorizado.",
        403: "Sin acceso a esta solución.",
        404: "Esta solución no tiene una vista de caso disponible.",
        503: "Los datos de esta solución todavía no están habilitados.",
      };
      return NextResponse.json(
        { error: errors[decision.status] },
        { status: decision.status }
      );
    }
    const result = await datosList(pgDatosRepo, ctx.grant.organizationId, {
      collection: decision.view.collection,
      limit: 50,
    });
    if (!result.success) {
      return NextResponse.json(
        { error: "No pudimos cargar los datos de la solución." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        view: decision.view,
        records: result.records,
        sources: await sourcesViewForWorkflow(workflowId, decision.solution),
        canRun: decision.canRun,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar la solución. Reintentá." },
      { status: 503 }
    );
  }
}
