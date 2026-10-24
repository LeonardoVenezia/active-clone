import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateWorkflowIntegrations } from "@/lib/db/integrations";
import { workflowExecutions, workflowShares, workflows } from "@/lib/db/schema";
import { MANUAL_INPUT_MAX_VALUE, manualInputConfigProblems, manualInputFields, prepareInput } from "@/lib/manual-input";
import { executeWorkflow } from "@/lib/workflow-executor.workflow";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";

// biome-ignore lint/nursery/useMaxParams: Background execution requires all workflow context
async function executeWorkflowBackground(
  executionId: string,
  workflowId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  input: Record<string, unknown>
) {
  try {
    console.log("[Workflow Execute] Starting execution:", executionId);

    // SECURITY: We pass only the workflowId as a reference
    // Steps will fetch credentials internally using fetchWorkflowCredentials(workflowId)
    // This prevents credentials from being logged in Vercel's observability
    console.log("[Workflow Execute] Calling executeWorkflow with:", {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      hasExecutionId: !!executionId,
      workflowId,
    });

    // Use start() from workflow/api to properly execute the workflow
    start(executeWorkflow, [
      {
        nodes,
        edges,
        triggerInput: input,
        executionId,
        workflowId, // Pass workflow ID so steps can fetch credentials
      },
    ]);

    console.log("[Workflow Execute] Workflow started successfully");
  } catch (error) {
    console.error("[Workflow Execute] Error during execution:", error);
    console.error(
      "[Workflow Execute] Error stack:",
      error instanceof Error ? error.stack : "N/A"
    );

    // Update execution record with error
    await db
      .update(workflowExecutions)
      .set({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, executionId));
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await context.params;

    // Get session
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get workflow and verify ownership
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    if (workflow.userId !== session.user.id) {
      // Flows can also be run by users they are explicitly shared with
      const share = await db.query.workflowShares.findFirst({
        where: and(
          eq(workflowShares.workflowId, workflowId),
          eq(workflowShares.sharedWithUserId, session.user.id)
        ),
      });
      if (!share) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Validate integration references against the workflow owner (shared
    // editors run with the owner's connections)
    const validation = await validateWorkflowIntegrations(
      workflow.nodes as WorkflowNode[],
      workflow.userId
    );
    if (!validation.valid) {
      console.error(
        "[Workflow Execute] Invalid integration references:",
        validation.invalidIds
      );
      return NextResponse.json(
        { error: "Workflow contains invalid integration references" },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));
    let input: Record<string, unknown> = body.input || {};
    // A Manual trigger that asks for data: keep only the declared keys and refuse a run that lacks a required one.
    if (manualInputConfigProblems(workflow.nodes as WorkflowNode[] as never).length) {
      return NextResponse.json(
        { error: "El disparador Manual tiene mal definidos los datos que pide (inputFields). No se ejecutó nada: corregilo desde el chat o el panel del disparador.", invalidInputFields: true },
        { status: 400 }
      );
    }
    const askedFields = manualInputFields(workflow.nodes as WorkflowNode[] as never);
    if (askedFields.length) {
      const prepared = prepareInput(askedFields, input);
      if (prepared.missing.length) {
        return NextResponse.json(
          { error: `Falta completar: ${prepared.missing.join(", ")}`, missingInput: prepared.missing },
          { status: 400 }
        );
      }
      if (prepared.tooLong.length) {
        return NextResponse.json(
          { error: `Demasiado largo (máximo ${MANUAL_INPUT_MAX_VALUE} caracteres): ${prepared.tooLong.join(", ")}`, tooLongInput: prepared.tooLong },
          { status: 400 }
        );
      }
      input = prepared.input;
    }

    // Create execution record
    const [execution] = await db
      .insert(workflowExecutions)
      .values({
        workflowId,
        userId: session.user.id,
        status: "running",
        input,
      })
      .returning();

    console.log("[API] Created execution:", execution.id);

    // Execute the workflow in the background (don't await)
    executeWorkflowBackground(
      execution.id,
      workflowId,
      workflow.nodes as WorkflowNode[],
      workflow.edges as WorkflowEdge[],
      input
    );

    // Return immediately with the execution ID
    return NextResponse.json({
      executionId: execution.id,
      status: "running",
    });
  } catch (error) {
    console.error("Failed to start workflow execution:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to execute workflow",
      },
      { status: 500 }
    );
  }
}
