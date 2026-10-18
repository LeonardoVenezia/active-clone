import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowTemplates, workflows } from "@/lib/db/schema";

// GET /api/templates — list the current user's templates (newest first)
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templates = await db.query.workflowTemplates.findMany({
      where: eq(workflowTemplates.userId, session.user.id),
      orderBy: [desc(workflowTemplates.updatedAt)],
    });

    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        steps: (t.nodes as { data?: { type?: string } }[]).filter(
          (n) => n.data?.type !== "trigger"
        ).length,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Failed to list templates:", error);
    return NextResponse.json(
      { error: "Failed to list templates" },
      { status: 500 }
    );
  }
}

// POST /api/templates — save an existing workflow as a template.
// Body: { workflowId: string, name?: string, description?: string }
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    if (!body.workflowId) {
      return NextResponse.json(
        { error: "workflowId is required" },
        { status: 400 }
      );
    }

    // Only the owner can turn a workflow into a template
    const sourceWorkflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, body.workflowId),
        eq(workflows.userId, session.user.id)
      ),
    });

    if (!sourceWorkflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : sourceWorkflow.name;

    const [template] = await db
      .insert(workflowTemplates)
      .values({
        userId: session.user.id,
        name,
        description:
          typeof body.description === "string" ? body.description : null,
        sourceWorkflowId: sourceWorkflow.id,
        nodes: sourceWorkflow.nodes,
        edges: sourceWorkflow.edges,
      })
      .returning();

    return NextResponse.json({
      id: template.id,
      name: template.name,
      description: template.description,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Failed to create template:", error);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 }
    );
  }
}
