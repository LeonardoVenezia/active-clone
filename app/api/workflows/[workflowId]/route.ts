import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateWorkflowIntegrations } from "@/lib/db/integrations";
import {
  workflowExecutionLogs,
  workflowExecutions,
  workflowShares,
  workflows,
} from "@/lib/db/schema";

// A user can edit a workflow they own or one explicitly shared with them
async function hasShareAccess(
  workflowId: string,
  userId: string
): Promise<boolean> {
  const share = await db.query.workflowShares.findFirst({
    where: and(
      eq(workflowShares.workflowId, workflowId),
      eq(workflowShares.sharedWithUserId, userId)
    ),
  });
  return !!share;
}

// Helper to strip sensitive data from nodes for public viewing
function sanitizeNodesForPublicView(
  nodes: Record<string, unknown>[]
): Record<string, unknown>[] {
  return nodes.map((node) => {
    const sanitizedNode = { ...node };
    if (
      sanitizedNode.data &&
      typeof sanitizedNode.data === "object" &&
      sanitizedNode.data !== null
    ) {
      const data = { ...(sanitizedNode.data as Record<string, unknown>) };
      // Remove integrationId from config to not expose which integrations are used
      if (
        data.config &&
        typeof data.config === "object" &&
        data.config !== null
      ) {
        const { integrationId: _, ...configWithoutIntegration } =
          data.config as Record<string, unknown>;
        data.config = configWithoutIntegration;
      }
      sanitizedNode.data = data;
    }
    return sanitizedNode;
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await context.params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    // First, try to find the workflow
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    const isOwner = session?.user?.id === workflow.userId;
    const isSharedWithUser =
      !isOwner && session?.user?.id
        ? await hasShareAccess(workflowId, session.user.id)
        : false;

    // If not owner and not shared, check if workflow is public
    if (!isOwner && !isSharedWithUser && workflow.visibility !== "public") {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    // Shared editors work with the owner's connections: give them the full
    // nodes so edits preserve the saved integration references. Public
    // non-owners still get sanitized nodes.
    const canEdit = isOwner || isSharedWithUser;
    const responseData = {
      ...workflow,
      nodes: canEdit
        ? workflow.nodes
        : sanitizeNodesForPublicView(
            workflow.nodes as Record<string, unknown>[]
          ),
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
      isOwner,
      canEdit,
      shared: isSharedWithUser,
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Failed to get workflow:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get workflow",
      },
      { status: 500 }
    );
  }
}

// Helper to build update data from request body
function buildUpdateData(
  body: Record<string, unknown>
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) {
    updateData.name = body.name;
  }
  if (body.description !== undefined) {
    updateData.description = body.description;
  }
  if (body.nodes !== undefined) {
    updateData.nodes = body.nodes;
  }
  if (body.edges !== undefined) {
    updateData.edges = body.edges;
  }
  if (body.visibility !== undefined) {
    updateData.visibility = body.visibility;
  }
  if (body.active !== undefined) {
    updateData.active = body.active;
  }

  return updateData;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await context.params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify edit access: owner or a user the flow is shared with
    const ownedWorkflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, session.user.id)
      ),
    });

    const isOwner = !!ownedWorkflow;
    let existingWorkflow = ownedWorkflow;
    if (!existingWorkflow) {
      const shared = await hasShareAccess(workflowId, session.user.id);
      if (shared) {
        existingWorkflow = await db.query.workflows.findFirst({
          where: eq(workflows.id, workflowId),
        });
      }
    }

    if (!existingWorkflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Only the owner can change visibility
    if (body.visibility !== undefined && !isOwner) {
      return NextResponse.json(
        { error: "Only the workflow owner can change visibility" },
        { status: 403 }
      );
    }

    // Validate that all integrationIds in nodes belong to the workflow owner
    // (shared editors edit on top of the owner's connections)
    if (Array.isArray(body.nodes)) {
      const validation = await validateWorkflowIntegrations(
        body.nodes,
        existingWorkflow.userId
      );
      if (!validation.valid) {
        return NextResponse.json(
          { error: "Invalid integration references in workflow" },
          { status: 403 }
        );
      }
    }

    // Validate visibility value if provided
    if (
      body.visibility !== undefined &&
      body.visibility !== "private" &&
      body.visibility !== "public"
    ) {
      return NextResponse.json(
        { error: "Invalid visibility value. Must be 'private' or 'public'" },
        { status: 400 }
      );
    }

    if (body.active !== undefined && typeof body.active !== "boolean") {
      return NextResponse.json(
        { error: "Invalid active value. Must be a boolean" },
        { status: 400 }
      );
    }

    // A workflow can only be turned on if it has a complete integration trigger.
    if (body.active === true) {
      const nodesToCheck = (
        Array.isArray(body.nodes) ? body.nodes : existingWorkflow.nodes
      ) as Array<{ data?: { type?: string; config?: Record<string, unknown> } }>;
      const trigger = nodesToCheck.find((n) => n.data?.type === "trigger");
      const config = trigger?.data?.config;
      if (
        config?.triggerType !== "Integration" ||
        !config.integrationTrigger ||
        !config.integrationId
      ) {
        return NextResponse.json(
          {
            error:
              "Choose an integration event and a connection in the trigger before turning the workflow on",
          },
          { status: 400 }
        );
      }
    }

    const updateData = buildUpdateData(body);

    const [updatedWorkflow] = await db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, workflowId))
      .returning();

    if (!updatedWorkflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...updatedWorkflow,
      createdAt: updatedWorkflow.createdAt.toISOString(),
      updatedAt: updatedWorkflow.updatedAt.toISOString(),
      isOwner,
      canEdit: true,
      shared: !isOwner,
    });
  } catch (error) {
    console.error("Failed to update workflow:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update workflow",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await context.params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership
    const existingWorkflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, session.user.id)
      ),
    });

    if (!existingWorkflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    // Cascade: delete only what belongs to THIS workflow - execution logs,
    // executions, and share rows - then the workflow itself.
    const executions = await db.query.workflowExecutions.findMany({
      where: eq(workflowExecutions.workflowId, workflowId),
      columns: { id: true },
    });
    const executionIds = executions.map((e) => e.id);
    if (executionIds.length > 0) {
      await db
        .delete(workflowExecutionLogs)
        .where(inArray(workflowExecutionLogs.executionId, executionIds));
      await db
        .delete(workflowExecutions)
        .where(eq(workflowExecutions.workflowId, workflowId));
    }
    await db.delete(workflowShares).where(eq(workflowShares.workflowId, workflowId));

    await db.delete(workflows).where(eq(workflows.id, workflowId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete workflow:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete workflow",
      },
      { status: 500 }
    );
  }
}
