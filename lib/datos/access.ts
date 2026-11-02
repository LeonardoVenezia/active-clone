import "server-only";

import { and, eq } from "drizzle-orm";
import { managementWorkflowScopes } from "@/lib/console/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, workflowShares, workflows } from "@/lib/db/schema";
import { type AccessFacts, decideWorkflowOrg } from "./frontend";

/** Gather the access facts for a workflow on the server (session, ownership, share, scope, membership). */
export async function workflowAccessFacts(request: Request, workflowId: string): Promise<{ facts: AccessFacts; nodes: unknown; userId: string | null; memberRole: string | null }> {
  const session = await auth.api.getSession({ headers: request.headers });
  const user = session?.user;
  const flow = user ? await db.query.workflows.findFirst({ where: eq(workflows.id, workflowId) }) : undefined;
  const share = user && flow && flow.userId !== user.id ? await db.query.workflowShares.findFirst({ where: and(eq(workflowShares.workflowId, workflowId), eq(workflowShares.sharedWithUserId, user.id)) }) : undefined;
  const [scope] = flow ? await db.select({ organizationId: managementWorkflowScopes.organizationId }).from(managementWorkflowScopes).where(eq(managementWorkflowScopes.workflowId, workflowId)) : [];
  const member = user && scope ? await db.query.members.findFirst({ where: and(eq(members.userId, user.id), eq(members.organizationId, scope.organizationId)) }) : undefined;
  return {
    userId: user?.id ?? null,
    memberRole: member?.role ?? null,
    nodes: flow?.nodes,
    facts: {
      signedIn: !!user,
      anonymous: !!user?.isAnonymous,
      workflowExists: !!flow,
      isOwner: !!user && !!flow && flow.userId === user.id,
      hasShare: !!share,
      scopeOrganizationId: scope?.organizationId ?? null,
      isMemberOfScopeOrg: !!member,
    },
  };
}

/**
 * Resolve the organization for a workflow on the server. The caller must be
 * signed in, own or be shared on the workflow, AND be a member of the
 * organization the workflow is scoped to. Never taken from the request.
 */
export async function orgForWorkflowRead(request: Request, workflowId: string): Promise<{ organizationId: string; userId: string; nodes: unknown; memberRole: string | null } | null> {
  const { facts, nodes, userId, memberRole } = await workflowAccessFacts(request, workflowId);
  const organizationId = decideWorkflowOrg(facts);
  return organizationId && userId ? { organizationId, userId, nodes, memberRole } : null;
}
