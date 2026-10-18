import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { integrations, workflowTemplates, workflows } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

type WorkflowNodeLike = {
  id: string;
  data?: {
    config?: {
      integrationId?: string;
      [key: string]: unknown;
    };
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type WorkflowEdgeLike = {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
};

// POST /api/templates/[templateId]/use — import a template as a new workflow.
// Node IDs are regenerated and edges remapped. Connections (integrationId)
// are kept only if that integration still exists in the user's account;
// otherwise the reference is dropped and the step will ask for a connection.
export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await context.params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const template = await db.query.workflowTemplates.findFirst({
      where: and(
        eq(workflowTemplates.id, templateId),
        eq(workflowTemplates.userId, session.user.id)
      ),
    });

    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const oldNodes = template.nodes as WorkflowNodeLike[];

    // Which integrations referenced by the template still exist for this user?
    const referencedIds = new Set<string>();
    for (const node of oldNodes) {
      const integrationId = node.data?.config?.integrationId;
      if (typeof integrationId === "string" && integrationId) {
        referencedIds.add(integrationId);
      }
    }

    let validIntegrationIds = new Set<string>();
    if (referencedIds.size > 0) {
      const existing = await db.query.integrations.findMany({
        where: and(
          inArray(integrations.id, [...referencedIds]),
          eq(integrations.userId, session.user.id)
        ),
      });
      validIntegrationIds = new Set(existing.map((i) => i.id));
    }

    // Regenerate node IDs, reset status, drop dangling connection refs
    const idMap = new Map<string, string>();
    const newNodes = oldNodes.map((node) => {
      const newId = nanoid();
      idMap.set(node.id, newId);
      const newNode: WorkflowNodeLike = { ...node, id: newId };
      if (newNode.data) {
        const data = { ...newNode.data };
        if (data.config) {
          const config = { ...data.config };
          if (
            typeof config.integrationId === "string" &&
            !validIntegrationIds.has(config.integrationId)
          ) {
            delete config.integrationId;
          }
          data.config = config;
        }
        data.status = "idle";
        newNode.data = data;
      }
      return newNode;
    });

    const newEdges = (template.edges as WorkflowEdgeLike[]).map((edge) => ({
      ...edge,
      id: nanoid(),
      source: idMap.get(edge.source) || edge.source,
      target: idMap.get(edge.target) || edge.target,
    }));

    // Pick a name that doesn't collide with the user's existing workflows
    const userWorkflows = await db.query.workflows.findMany({
      where: eq(workflows.userId, session.user.id),
    });
    const existingNames = new Set(userWorkflows.map((w) => w.name));
    let workflowName = template.name;
    if (existingNames.has(workflowName)) {
      let counter = 2;
      while (existingNames.has(`${template.name} ${counter}`)) {
        counter += 1;
      }
      workflowName = `${template.name} ${counter}`;
    }

    const [newWorkflow] = await db
      .insert(workflows)
      .values({
        id: generateId(),
        name: workflowName,
        description: template.description,
        nodes: newNodes,
        edges: newEdges,
        userId: session.user.id,
        visibility: "private",
      })
      .returning();

    return NextResponse.json({
      id: newWorkflow.id,
      name: newWorkflow.name,
      droppedConnections: referencedIds.size - validIntegrationIds.size,
      createdAt: newWorkflow.createdAt.toISOString(),
      updatedAt: newWorkflow.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Failed to use template:", error);
    return NextResponse.json(
      { error: "Failed to use template" },
      { status: 500 }
    );
  }
}
