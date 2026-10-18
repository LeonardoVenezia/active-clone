import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflowTemplates } from "@/lib/db/schema";
import { canManageOrgTemplates, getOrgContext } from "@/lib/org-utils";

// Manage (rename/delete) rules: personal templates belong to their creator;
// org templates are managed by that org's owners/admins.
async function getManageableTemplate(request: Request, templateId: string) {
  const ctx = await getOrgContext(request);
  if (!ctx) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const template = await db.query.workflowTemplates.findFirst({
    where: eq(workflowTemplates.id, templateId),
  });

  if (!template) {
    return {
      error: NextResponse.json({ error: "Template not found" }, { status: 404 }),
    };
  }

  const isPersonalOwner = !template.orgId && template.userId === ctx.userId;
  const isOrgManager =
    !!template.orgId &&
    template.orgId === ctx.activeOrganizationId &&
    canManageOrgTemplates(ctx);

  if (!(isPersonalOwner || isOrgManager)) {
    return {
      error: NextResponse.json({ error: "Template not found" }, { status: 404 }),
    };
  }

  return { template, ctx };
}

// PATCH /api/templates/[templateId] — rename or change description.
// Body: { name?: string, description?: string | null }
export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await context.params;
    const { template, error } = await getManageableTemplate(request, templateId);
    if (error) return error;

    const body = await request.json();
    const updates: { name?: string; description?: string | null } = {};

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if ("description" in body) {
      updates.description =
        typeof body.description === "string" ? body.description : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const [updated] = await db
      .update(workflowTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(workflowTemplates.id, template!.id))
      .returning();

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Failed to update template:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}

// DELETE /api/templates/[templateId] — delete a template (does not touch workflows)
export async function DELETE(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await context.params;
    const { template, error } = await getManageableTemplate(request, templateId);
    if (error) return error;

    await db
      .delete(workflowTemplates)
      .where(eq(workflowTemplates.id, template!.id));

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete template:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
