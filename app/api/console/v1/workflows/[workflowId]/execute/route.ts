import { NextResponse } from "next/server";
import { canRunWithCompanyVariables } from "@/lib/company/run-policy";
import { companyVariableKeys } from "@/lib/company-variables";
import { consoleContext } from "@/lib/console/context";
import { runtimeAssignments, visibleWorkflows } from "@/lib/console/data";
import { consoleDataExecution } from "@/lib/console/data-execution";
import { reserveAndLaunch } from "@/lib/console/execution";
import { canExecute } from "@/lib/console/policy";
import { isManualConsoleWorkflow } from "@/lib/console/workflow-summary";
import { validateWorkflowIntegrations } from "@/lib/db/integrations";
import {
  isLeoConsoleFixture,
  leoProductionGrant,
} from "@/lib/demo/console-scope";

function allowedOrigin(request: Request) {
  return (
    !!process.env.CONSOLE_ORIGIN &&
    request.headers.get("origin") === process.env.CONSOLE_ORIGIN
  );
}
function deniedCompanyVariables(
  nodes: Parameters<typeof companyVariableKeys>[0],
  userId: string,
  organizationId: string,
  workflowId: string
) {
  return (
    companyVariableKeys(nodes).length > 0 &&
    !canRunWithCompanyVariables({ userId, organizationId, workflowId })
  );
}
function executionDisabled(demo: boolean) {
  return process.env.CONSOLE_EXECUTION_ENABLED !== "true" && !demo;
}
function rejectsEditedDemo(
  userId: string,
  organizationId: string,
  demo: boolean
) {
  return (
    !!leoProductionGrant(
      process.env.VERCEL_ENV,
      process.env.CONSOLE_ORIGIN,
      userId,
      organizationId
    ) && !demo
  );
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    if (!allowedOrigin(request)) {
      return NextResponse.json(
        { error: "Origen no permitido." },
        { status: 403 }
      );
    }
    const ctx = await consoleContext(request);
    if (!ctx) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    const { workflowId } = await params;
    const assignment = (await runtimeAssignments()).find(
      (x) =>
        x.organizationId === ctx.grant.organizationId &&
        x.workflowId === workflowId
    );
    const workflows = await visibleWorkflows(
      ctx.grant,
      ctx.organization.metadata
    );
    const w = workflows.find((x) => x.id === workflowId);
    const manual = !!w && isManualConsoleWorkflow(w.nodes);
    const demo =
      !!w &&
      isLeoConsoleFixture({
        environment: process.env.VERCEL_ENV,
        consoleOrigin: process.env.CONSOLE_ORIGIN,
        userId: ctx.user.id,
        organizationId: ctx.organization.id,
        workflowId,
        nodes: w.nodes,
        edges: w.edges,
      });
    // The demo grant never runs an edited graph, even if somebody activates it.
    if (rejectsEditedDemo(ctx.user.id, ctx.organization.id, demo)) {
      return NextResponse.json(
        { error: "El ejemplo de prueba cambió. No se ejecutó nada." },
        { status: 403 }
      );
    }
    if (
      !(
        assignment &&
        w &&
        canExecute(ctx.grant, assignment, manual, w.active || demo)
      )
    ) {
      return NextResponse.json(
        { error: "No autorizado para iniciar este workflow." },
        { status: 403 }
      );
    }
    if (executionDisabled(demo)) {
      return NextResponse.json(
        {
          error:
            "Las corridas desde la consola todavía no están habilitadas. No se ejecutó nada.",
        },
        { status: 503 }
      );
    }
    const text = await request.text();
    if (text.length > 8192) {
      return NextResponse.json(
        { error: "Datos demasiado grandes." },
        { status: 413 }
      );
    }
    let body: { idempotencyKey?: unknown; input?: Record<string, unknown> };
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Solicitud no válida." },
        { status: 400 }
      );
    }
    if (
      deniedCompanyVariables(
        w.nodes,
        w.userId,
        ctx.grant.organizationId,
        workflowId
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Las variables de empresa todavía no están habilitadas para ejecutar. No se inició ningún servicio.",
        },
        { status: 409 }
      );
    }
    const dataScope = await consoleDataExecution(
      request,
      workflowId,
      ctx.grant.organizationId,
      w.nodes
    );
    if (!dataScope) {
      return NextResponse.json(
        {
          error:
            "Datos no está disponible para este workflow. No se inició ningún servicio.",
        },
        { status: 409 }
      );
    }
    const validation = await validateWorkflowIntegrations(
      w.nodes as never,
      w.userId
    );
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Una conexión requiere revisión. No se ejecutó nada." },
        { status: 409 }
      );
    }
    const result = await reserveAndLaunch(
      ctx.grant.organizationId,
      ctx.user.id,
      w,
      body.idempotencyKey,
      body.input,
      async (id, flow, input) => {
        const { start } = await import("workflow/api");
        const { executeWorkflow } = await import(
          "@/lib/workflow-executor.workflow"
        );
        await start(executeWorkflow, [
          {
            ...dataScope,
            nodes: flow.nodes,
            edges: flow.edges,
            triggerInput: input,
            executionId: id,
            workflowId: flow.id,
            userId: ctx.user.id,
            organizationId: ctx.grant.organizationId,
          },
        ]);
      }
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "No se pudo confirmar la solicitud. Revisá el historial antes de reintentar.",
      },
      { status: 503 }
    );
  }
}
