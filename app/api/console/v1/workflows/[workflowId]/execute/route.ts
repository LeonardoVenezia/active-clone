import { NextResponse } from "next/server";
import { consoleContext } from "@/lib/console/context";
import { runtimeAssignments, visibleWorkflows } from "@/lib/console/data";
import { canExecute } from "@/lib/console/policy";
import { reserveAndLaunch } from "@/lib/console/execution";
import { validateWorkflowIntegrations } from "@/lib/db/integrations";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  try {
    if (
      !process.env.CONSOLE_ORIGIN ||
      request.headers.get("origin") !== process.env.CONSOLE_ORIGIN
    )
      return NextResponse.json(
        { error: "Origen no permitido." },
        { status: 403 },
      );
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const { workflowId } = await params;
    const assignment = (await runtimeAssignments()).find(
      (x) =>
        x.organizationId === ctx.grant.organizationId &&
        x.workflowId === workflowId,
    );
    const workflows = await visibleWorkflows(
      ctx.grant,
      ctx.organization.metadata,
    );
    const w = workflows.find((x) => x.id === workflowId);
    const manual =
      w?.nodes.some(
        (n: any) =>
          n.data?.type === "trigger" &&
          n.data?.config?.triggerType === "Manual",
      ) || false;
    if (
      !assignment ||
      !w ||
      !canExecute(ctx.grant, assignment, manual, w.active)
    )
      return NextResponse.json(
        { error: "No autorizado para iniciar este workflow." },
        { status: 403 },
      );
    if (process.env.CONSOLE_EXECUTION_ENABLED !== "true")
      return NextResponse.json(
        {
          error:
            "Las corridas desde la consola todavía no están habilitadas. No se ejecutó nada.",
        },
        { status: 503 },
      );
    const text = await request.text();
    if (text.length > 8192)
      return NextResponse.json(
        { error: "Datos demasiado grandes." },
        { status: 413 },
      );
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Solicitud no válida." },
        { status: 400 },
      );
    }
    const validation = await validateWorkflowIntegrations(
      w.nodes as never,
      w.userId,
    );
    if (!validation.valid)
      return NextResponse.json(
        { error: "Una conexión requiere revisión. No se ejecutó nada." },
        { status: 409 },
      );
    const result = await reserveAndLaunch(
      ctx.grant.organizationId,
      ctx.user.id,
      w,
      body.idempotencyKey,
      body.input,
      async (id, flow, input) => {
        const { start } = await import("workflow/api");
        const { executeWorkflow } =
          await import("@/lib/workflow-executor.workflow");
        await start(executeWorkflow, [
          {
            nodes: flow.nodes,
            edges: flow.edges,
            triggerInput: input,
            executionId: id,
            workflowId: flow.id,
          },
        ]);
      },
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
      { status: 503 },
    );
  }
}
