import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { members, workflowTemplates, workflows } from "@/lib/db/schema";
import { getOrgContext } from "@/lib/org-utils";
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
    const ctx = await getOrgContext(request);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, templateId),
    });

    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Personal templates: only the creator. Org templates: any current member
    // of that org can import a copy into their own account.
    if (template.orgId) {
      const membership = await db.query.members.findFirst({
        where: and(
          eq(members.organizationId, template.orgId),
          eq(members.userId, ctx.userId)
        ),
      });
      if (!membership) {
        return NextResponse.json(
          { error: "Template not found" },
          { status: 404 }
        );
      }
    } else if (template.userId !== ctx.userId) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const oldNodes = template.nodes as WorkflowNodeLike[];

    // Templates never carry connections: strip every integrationId (older
    // templates saved before this rule may still contain them) so each step
    // asks the importer to connect their own account.
    let strippedConnections = 0;
    const idMap = new Map<string, string>();
    const newNodes = oldNodes.map((node) => {
      const newId = nanoid();
      idMap.set(node.id, newId);
      const newNode: WorkflowNodeLike = { ...node, id: newId };
      if (newNode.data) {
        const data = { ...newNode.data };
        if (data.config) {
          const config = { ...data.config };
          if (typeof config.integrationId === "string") {
            delete config.integrationId;
            strippedConnections += 1;
          }
          // Mark template-imported steps so the editor does not auto-assign
          // a connection on load: the importer must pick their own.
          config.fromTemplate = true;
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
      where: eq(workflows.userId, ctx.userId),
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
        userId: ctx.userId,
        visibility: "private",
      })
      .returning();

    return NextResponse.json({
      id: newWorkflow.id,
      name: newWorkflow.name,
      droppedConnections: strippedConnections,
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
