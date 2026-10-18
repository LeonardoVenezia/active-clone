import { and, desc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflowTemplates, workflows } from "@/lib/db/schema";
import { canManageOrgTemplates, getOrgContext } from "@/lib/org-utils";

// GET /api/templates — list the current user's templates (newest first)
export async function GET(request: Request) {
  try {
    const ctx = await getOrgContext(request);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Visible templates: my personal ones (never shared) plus the ones of my
    // active organization. Templates of other orgs are never returned.
    const visibility = ctx.activeOrganizationId
      ? or(
          and(
            eq(workflowTemplates.userId, ctx.userId),
            isNull(workflowTemplates.orgId)
          ),
          eq(workflowTemplates.orgId, ctx.activeOrganizationId)
        )
      : and(
          eq(workflowTemplates.userId, ctx.userId),
          isNull(workflowTemplates.orgId)
        );

    const templates = await db.query.workflowTemplates.findMany({
      where: visibility,
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
        orgId: t.orgId,
        mine: t.userId === ctx.userId,
        canManage:
          t.userId === ctx.userId ||
          (!!t.orgId &&
            t.orgId === ctx.activeOrganizationId &&
            canManageOrgTemplates(ctx)),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      activeOrganizationId: ctx.activeOrganizationId,
      canManageOrgTemplates: canManageOrgTemplates(ctx),
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
    const ctx = await getOrgContext(request);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    if (!body.workflowId) {
      return NextResponse.json(
        { error: "workflowId is required" },
        { status: 400 }
      );
    }

    // Sharing with the company is opt-in and restricted to org owners/admins
    // (workers keep personal templates only, per product decision).
    const shareWithOrg =
      body.shareWithOrg === true &&
      ctx.activeOrganizationId &&
      canManageOrgTemplates(ctx);
    const orgId = shareWithOrg ? ctx.activeOrganizationId : null;

    // Only the owner can turn a workflow into a template
    const sourceWorkflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, body.workflowId),
        eq(workflows.userId, ctx.userId)
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

    // Templates are structure only: strip every connection reference so an
    // import always asks for the importer's own connections.
    const strippedNodes = (
      sourceWorkflow.nodes as {
        data?: { config?: Record<string, unknown> };
      }[]
    ).map((node) => {
      if (!node.data?.config || !("integrationId" in node.data.config)) {
        return node;
      }
      const { integrationId: _dropped, ...config } = node.data.config;
      return { ...node, data: { ...node.data, config } };
    });

    const [template] = await db
      .insert(workflowTemplates)
      .values({
        userId: ctx.userId,
        orgId,
        name,
        description:
          typeof body.description === "string" ? body.description : null,
        sourceWorkflowId: sourceWorkflow.id,
        nodes: strippedNodes,
        edges: sourceWorkflow.edges,
      })
      .returning();

    return NextResponse.json({
      id: template.id,
      name: template.name,
      description: template.description,
      orgId: template.orgId,
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
