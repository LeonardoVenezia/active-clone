import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseGrant, type ConsoleGrant } from "./policy";
import { consoleSetups, consoleGrants } from "./schema";
export async function effectiveGrant(
  userId: string,
  organizationId: string,
): Promise<ConsoleGrant | null> {
  const root = parseGrant(
    process.env.CONSOLE_ACCESS_CONFIG || null,
    userId,
    organizationId,
  );
  if (root?.role === "owner") return root;
  if (process.env.CONSOLE_PERSISTENT_CONFIG_ENABLED === "true") {
    const [setup] = await db
      .select()
      .from(consoleSetups)
      .where(
        and(
          eq(consoleSetups.organizationId, organizationId),
          eq(consoleSetups.ownerId, userId),
          eq(consoleSetups.enabled, true),
        ),
      );
    if (setup) {
      const { members } = await import("@/lib/db/schema");
      const member = await db.query.members.findFirst({
        where: and(
          eq(members.organizationId, organizationId),
          eq(members.userId, userId),
          eq(members.role, "owner"),
        ),
      });
      if (member)
        return {
          userId,
          organizationId,
          role: "owner",
          teamIds: [],
          workflowIds: [],
          canRun: false,
        };
    }
  }
  if (process.env.CONSOLE_STORAGE_ENABLED !== "true") return root;
  const [row] = await db
    .select()
    .from(consoleGrants)
    .where(
      and(
        eq(consoleGrants.userId, userId),
        eq(consoleGrants.organizationId, organizationId),
      ),
    );
  if (!row) return root;
  if (!row.enabled) return null;
  return parseGrant(
    JSON.stringify({
      organizations: { [organizationId]: { users: { [userId]: row } } },
    }),
    userId,
    organizationId,
  );
}
