import "server-only";

import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";

export type OrgContext = {
  userId: string;
  activeOrganizationId: string | null;
  // Role of the user in the active org ("owner" | "admin" | "member"), or null
  // when the user has no active org or is not a member of it.
  activeOrgRole: string | null;
};

/**
 * Resolve the session user and their active-organization context in one place.
 * Returns null when there is no authenticated session.
 */
export async function getOrgContext(
  request: Request
): Promise<OrgContext | null> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return null;
  }

  const activeOrganizationId =
    (session.session?.activeOrganizationId as string | null | undefined) ||
    null;

  let activeOrgRole: string | null = null;
  if (activeOrganizationId) {
    const membership = await db.query.members.findFirst({
      where: and(
        eq(members.organizationId, activeOrganizationId),
        eq(members.userId, session.user.id)
      ),
    });
    activeOrgRole = membership?.role || null;
  }

  return { userId: session.user.id, activeOrganizationId, activeOrgRole };
}

/** Owners and admins manage company templates; workers cannot. */
export function canManageOrgTemplates(ctx: OrgContext): boolean {
  return (
    !!ctx.activeOrganizationId &&
    (ctx.activeOrgRole === "owner" || ctx.activeOrgRole === "admin")
  );
}
