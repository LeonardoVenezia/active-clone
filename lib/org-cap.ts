import "server-only";

import { APIError } from "better-auth/api";
import { and, count, eq } from "drizzle-orm";
import { db } from "./db";
import { invitations, members, organizations } from "./db/schema";

export type OrgSeatUsage = {
  memberCap: number | null;
  memberCount: number;
  pendingCount: number;
};

/** Members + pending invitations vs. the org's member cap (null = unlimited). */
export async function getOrgSeatUsage(
  organizationId: string
): Promise<OrgSeatUsage> {
  const [org] = await db
    .select({ memberCap: organizations.memberCap })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const [memberRow] = await db
    .select({ value: count() })
    .from(members)
    .where(eq(members.organizationId, organizationId));
  const [pendingRow] = await db
    .select({ value: count() })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.status, "pending")
      )
    );
  return {
    memberCap: org?.memberCap ?? null,
    memberCount: memberRow?.value ?? 0,
    pendingCount: pendingRow?.value ?? 0,
  };
}

/** Throw when inviting one more person would exceed the cap. */
export async function assertCanInvite(organizationId: string) {
  const { memberCap, memberCount, pendingCount } =
    await getOrgSeatUsage(organizationId);
  if (memberCap != null && memberCount + pendingCount >= memberCap) {
    throw new APIError("BAD_REQUEST", {
      code: "MEMBER_CAP_REACHED",
      message: `La empresa llegó a su límite de ${memberCap} miembros.`,
    });
  }
}

/** Throw when accepting an invitation would exceed the cap. */
export async function assertCanAccept(organizationId: string) {
  const { memberCap, memberCount } = await getOrgSeatUsage(organizationId);
  if (memberCap != null && memberCount >= memberCap) {
    throw new APIError("BAD_REQUEST", {
      code: "MEMBER_CAP_REACHED",
      message: `La empresa llegó a su límite de ${memberCap} miembros.`,
    });
  }
}
