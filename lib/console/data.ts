import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { members, workflowExecutions, workflows } from "@/lib/db/schema";
import { leoProductionAssignments } from "../demo/console-scope";
import { type Assignment, type ConsoleGrant, canView } from "./policy";
import { consoleAssignments, consoleSetups } from "./schema";
export function assignments(_metadata: string | null): Assignment[] {
  try {
    const v = JSON.parse(process.env.CONSOLE_ACCESS_CONFIG || "{}").assignments;
    if (!Array.isArray(v)) {
      return [];
    }
    const valid = v.filter(
      (x) =>
        x &&
        typeof x.organizationId === "string" &&
        typeof x.workflowId === "string" &&
        (x.teamId === null || typeof x.teamId === "string")
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
  _metadata: string | null
) {
  const permitted = (await runtimeAssignments()).filter((x) =>
    canView(grant, x)
  );
  if (!permitted.length) {
    return [];
  }
  const owners = await db
    .select({ id: members.userId })
    .from(members)
    .where(eq(members.organizationId, grant.organizationId));
  if (!owners.length) {
    return [];
  }
  return db
    .select()
    .from(workflows)
    .where(
      and(
        inArray(
          workflows.id,
          permitted.map((x) => x.workflowId)
        ),
        inArray(
          workflows.userId,
          owners.map((x) => x.id)
        )
      )
    );
}
export async function runHistory(ids: string[]) {
  if (!ids.length) {
    return [];
  }
  return await db
    .select({
      id: workflowExecutions.id,
      workflowId: workflowExecutions.workflowId,
      status: workflowExecutions.status,
      error: workflowExecutions.error,
      startedAt: workflowExecutions.startedAt,
      completedAt: workflowExecutions.completedAt,
    })
    .from(workflowExecutions)
    .where(inArray(workflowExecutions.workflowId, ids))
    .orderBy(desc(workflowExecutions.startedAt))
    .limit(100);
}

export function configuredAssignments() {
  return [
    ...assignments(null),
    ...leoProductionAssignments(
      process.env.VERCEL_ENV,
      process.env.CONSOLE_ORIGIN
    ),
  ];
}

export async function runtimeAssignments(): Promise<Assignment[]> {
  if (process.env.CONSOLE_PERSISTENT_CONFIG_ENABLED !== "true") {
    return [
      ...assignments(null),
      ...leoProductionAssignments(
        process.env.VERCEL_ENV,
        process.env.CONSOLE_ORIGIN
      ),
    ];
  }
  const rows = await db
    .select({
      workflowId: consoleAssignments.workflowId,
      organizationId: consoleAssignments.organizationId,
      teamId: consoleAssignments.teamId,
    })
    .from(consoleAssignments)
    .innerJoin(
      consoleSetups,
      and(
        eq(consoleSetups.organizationId, consoleAssignments.organizationId),
        eq(consoleSetups.enabled, true)
      )
    );
  const combined = [
    ...assignments(null),
    ...rows,
    ...leoProductionAssignments(
      process.env.VERCEL_ENV,
      process.env.CONSOLE_ORIGIN
    ),
  ];
  const scopes = new Map<string, Set<string>>();
  for (const r of combined) {
    const x = scopes.get(r.workflowId) || new Set<string>();
    x.add(r.organizationId);
    scopes.set(r.workflowId, x);
  }
  return combined.filter((r) => scopes.get(r.workflowId)?.size === 1);
}
