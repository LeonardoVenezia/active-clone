import { NextResponse } from "next/server";
import { consoleContext } from "@/lib/console/context";
import { visibleWorkflows, runHistory } from "@/lib/console/data";
import { canExecute } from "@/lib/console/policy";
import { runtimeAssignments } from "@/lib/console/data";
import { isManualConsoleWorkflow } from "@/lib/console/workflow-summary";
import { manualInputFields } from "@/lib/manual-input";
export async function GET(request: Request) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json(
        {
          error:
            "Ingresá con una cuenta habilitada para la consola y una organización activa.",
        },
        { status: 401 },
      );
    const rows = await visibleWorkflows(ctx.grant, ctx.organization.metadata);
    const mapped = await runtimeAssignments();
    const runs = await runHistory(rows.map((x) => x.id));
    return NextResponse.json(
      {
        user: { id: ctx.user.id, name: ctx.user.name || "" },
        organization: { id: ctx.organization.id, name: ctx.organization.name },
        role: ctx.grant.role,
        recentRunLimit: 100,
        workflows: rows.map((w) => {
          const manual = isManualConsoleWorkflow(w.nodes);
          return {
            id: w.id,
            name: w.name,
            description: w.description || "",
            teamName:
              mapped.find(
                (a) =>
                  a.workflowId === w.id &&
                  a.organizationId === ctx.grant.organizationId,
              )?.teamId || null,
            status: w.active ? "active" : "paused",
            manual,
            canRun:
              process.env.CONSOLE_EXECUTION_ENABLED === "true" &&
              mapped.some(
                (a) =>
                  a.workflowId === w.id &&
                  canExecute(ctx.grant, a, manual, w.active),
              ),
            inputFields: manualInputFields(w.nodes as never).map((f) => ({
              key: f.key,
              label: f.label || f.key,
              required: f.required,
            })),
            successfulRuns: runs.filter(
              (r) => r.workflowId === w.id && r.status === "success",
            ).length,
            failedRuns: runs.filter(
              (r) => r.workflowId === w.id && r.status === "error",
            ).length,
            lastRunAt:
              runs
                .find((r) => r.workflowId === w.id)
                ?.startedAt.toISOString() || null,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar la consola." },
      { status: 503 },
    );
  }
}
