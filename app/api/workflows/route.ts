import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, workflowShares, workflows } from "@/lib/db/schema";

export async function GET(request: Request) {
  try {
    const buildSha = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json([], { status: 200, headers: { "x-build-sha": buildSha } });
    }

    const userWorkflows = await db
      .select()
      .from(workflows)
      .where(eq(workflows.userId, session.user.id))
      .orderBy(desc(workflows.updatedAt));

    // Flows explicitly shared with this user by their creator
    const myShares = await db
      .select()
      .from(workflowShares)
      .where(eq(workflowShares.sharedWithUserId, session.user.id));

    let sharedWorkflows: (typeof workflows.$inferSelect)[] = [];
    if (myShares.length > 0) {
      sharedWorkflows = await db
        .select()
        .from(workflows)
        .where(
          inArray(
            workflows.id,
            myShares.map((share) => share.workflowId)
          )
        );
    }

    // Own flows that are shared with others belong in the shared section too
    const myIds = userWorkflows.map((workflow) => workflow.id);
    const sharesOfMine =
      myIds.length > 0
        ? await db
            .select({ workflowId: workflowShares.workflowId })
            .from(workflowShares)
            .where(inArray(workflowShares.workflowId, myIds))
        : [];
    const sharedByMeIds = new Set(sharesOfMine.map((row) => row.workflowId));

    // Am I owner/admin of a company the flow's owner belongs to?
    let adminOfOwnerIds = new Set<string>();
    if (sharedWorkflows.length > 0) {
      const myOrgRoles = await db
        .select({
          organizationId: members.organizationId,
          role: members.role,
        })
        .from(members)
        .where(eq(members.userId, session.user.id));
      const myAdminOrgSet = new Set(
        myOrgRoles
          .filter((row) => row.role === "owner" || row.role === "admin")
          .map((row) => row.organizationId)
      );
      if (myAdminOrgSet.size > 0) {
        const ownerMemberships = await db
          .select({
            userId: members.userId,
            organizationId: members.organizationId,
            role: members.role,
          })
          .from(members)
          .where(
            inArray(
              members.userId,
              sharedWorkflows.map((workflow) => workflow.userId)
            )
          );
        adminOfOwnerIds = new Set(
          ownerMemberships
            .filter((row) => myAdminOrgSet.has(row.organizationId))
            .map((row) => row.userId)
        );
      }
    }

    const mappedWorkflows = [
      ...userWorkflows.map((workflow) => ({
        ...workflow,
        createdAt: workflow.createdAt.toISOString(),
        updatedAt: workflow.updatedAt.toISOString(),
        isOwner: true,
        canEdit: true,
        sharedByMe: sharedByMeIds.has(workflow.id),
      })),
      ...sharedWorkflows.map((workflow) => ({
        ...workflow,
        createdAt: workflow.createdAt.toISOString(),
        updatedAt: workflow.updatedAt.toISOString(),
        isOwner: false,
        canEdit: true,
        shared: true,
        sharedAdmin: adminOfOwnerIds.has(workflow.userId),
      })),
    ];

    return NextResponse.json(mappedWorkflows);
  } catch (error) {
    console.error("Failed to get workflows:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get workflows",
      },
      { status: 500 }
    );
  }
}
