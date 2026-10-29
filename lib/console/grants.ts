import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseGrant, type ConsoleGrant } from "./policy";
import { consoleGrants } from "./schema";
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
