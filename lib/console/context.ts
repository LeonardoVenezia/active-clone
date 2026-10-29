import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, organizations } from "@/lib/db/schema";
import {hasConsoleAffiliation,selectedConsoleOrganization} from "./affiliation";
import { effectiveGrant } from "./grants";
export async function consoleContext(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAnonymous) return null;
  const orgId = await selectedConsoleOrganization(session.session.id,session.session.activeOrganizationId);
  if (!orgId || !await hasConsoleAffiliation(session.user.id,orgId)) return null;
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return null;
  const grant = await effectiveGrant(session.user.id, orgId);
  if (!grant) return null;
  return { user: session.user, organization: org, grant };
}
