import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { consoleAssignments, consoleSetups } from "./schema";
import { workflows, workflowExecutions, members } from "@/lib/db/schema";
import { canView, type ConsoleGrant, type Assignment } from "./policy";
export function assignments(metadata: string | null): Assignment[] {
  try {
    const v = JSON.parse(process.env.CONSOLE_ACCESS_CONFIG || "{}").assignments;
    if (!Array.isArray(v)) return [];
    const valid = v.filter(
      (x) =>
        x &&
        typeof x.organizationId === "string" &&
        typeof x.workflowId === "string" &&
        (x.teamId === null || typeof x.teamId === "string"),
    );
    // A workflow cannot belong to two tenant scopes, even after a config typo.
    const scopes = new Map<string, Set<string>>();
    for (const item of valid) {
      const values = scopes.get(item.workflowId) || new Set<string>();
      values.add(item.organizationId);
      scopes.set(item.workflowId, values);
    }
    return valid.filter((item) => scopes.get(item.workflowId)?.size === 1);
  } catch {
    return [];
  }
}
export async function visibleWorkflows(
  grant: ConsoleGrant,
  metadata: string | null,
) {
  const permitted = (await runtimeAssignments()).filter((x) => canView(grant, x));
  if (!permitted.length) return [];
  const owners = await db
    .select({ id: members.userId })
    .from(members)
    .where(eq(members.organizationId, grant.organizationId));
  if (!owners.length) return [];
  return db
    .select()
    .from(workflows)
    .where(
      and(
        inArray(
          workflows.id,
          permitted.map((x) => x.workflowId),
        ),
        inArray(
          workflows.userId,
          owners.map((x) => x.id),
        ),
      ),
    );
}
export async function runHistory(ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({
      id: workflowExecutions.id,
      workflowId: workflowExecutions.workflowId,
      status: workflowExecutions.status,
      startedAt: workflowExecutions.startedAt,
      completedAt: workflowExecutions.completedAt,
    })
    .from(workflowExecutions)
    .where(inArray(workflowExecutions.workflowId, ids))
    .orderBy(desc(workflowExecutions.startedAt))
    .limit(100);
}

export function configuredAssignments() {
  return assignments(null);
}

export async function runtimeAssignments(): Promise<Assignment[]> {
 if(process.env.CONSOLE_PERSISTENT_CONFIG_ENABLED!=="true")return assignments(null);
 const rows=await db.select({workflowId:consoleAssignments.workflowId,organizationId:consoleAssignments.organizationId,teamId:consoleAssignments.teamId}).from(consoleAssignments).innerJoin(consoleSetups,and(eq(consoleSetups.organizationId,consoleAssignments.organizationId),eq(consoleSetups.enabled,true)));
 const combined=[...assignments(null),...rows];
 const scopes=new Map<string,Set<string>>();for(const r of combined){const x=scopes.get(r.workflowId)||new Set<string>();x.add(r.organizationId);scopes.set(r.workflowId,x)}
 return combined.filter(r=>scopes.get(r.workflowId)?.size===1);
}
