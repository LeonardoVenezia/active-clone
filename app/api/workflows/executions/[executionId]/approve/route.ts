import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resumeHook } from "workflow/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowExecutions } from "@/lib/db/schema";

/**
 * POST /api/workflows/executions/[executionId]/approve
 * Body: { nodeId: string, approved: boolean, note?: string }
 * Resumes the run suspended on the Approval node's hook.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await context.params;
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || session.user.isAnonymous) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const execution = await db.query.workflowExecutions.findFirst({
      where: eq(workflowExecutions.id, executionId),
      with: { workflow: true },
    });
    if (!execution) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 }
      );
    }
    if (execution.workflow.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
    if (!nodeId) {
      return NextResponse.json({ error: "nodeId required" }, { status: 400 });
    }
    const approved = body.approved === true;
    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim()
        : undefined;

    const token = `approval:${executionId}:${nodeId}`;
    try {
      await resumeHook(token, { approved, note });
    } catch {
      return NextResponse.json(
        { error: "No hay ninguna aprobación pendiente para este paso." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, approved });
  } catch (error) {
    console.error("[approve] Failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resume" },
      { status: 500 }
    );
  }
}
