/**
 * Approval steps - record the pending-approval state of a human-approval node.
 * The wait itself happens in the workflow context via createHook (durable
 * pause); these "use step" functions only do the DB logging around it.
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutionLogs } from "@/lib/db/schema";

export type PendingApprovalInput = {
  executionId?: string;
  nodeId: string;
  nodeName: string;
  message: string;
  hookToken: string;
};

/**
 * Mark the approval node as waiting for a human decision.
 * The runs UI reads this log row (status "waiting_approval") and renders
 * the approve/reject control.
 */
export async function recordPendingApprovalStep(
  input: PendingApprovalInput
): Promise<{ logged: boolean }> {
  "use step";

  if (!input.executionId) return { logged: false };
  try {
    await db.insert(workflowExecutionLogs).values({
      executionId: input.executionId,
      nodeId: input.nodeId,
      nodeName: input.nodeName,
      nodeType: "Approval",
      status: "waiting_approval",
      input: { message: input.message },
      output: { hookToken: input.hookToken },
      startedAt: new Date(),
    });
    return { logged: true };
  } catch (error) {
    console.error("[Approval] Failed to record pending approval:", error);
    return { logged: false };
  }
}

export type ApprovalDecisionRecord = {
  executionId?: string;
  nodeId: string;
  approved: boolean;
  note?: string;
};

/** Mark the approval node decided (success or rejected). */
export async function recordApprovalDecisionStep(
  input: ApprovalDecisionRecord
): Promise<{ logged: boolean }> {
  "use step";

  if (!input.executionId) return { logged: false };
  try {
    // Close the waiting row for this node
    const waiting = await db.query.workflowExecutionLogs.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(
          eqOp(t.executionId, input.executionId as string),
          eqOp(t.nodeId, input.nodeId),
          eqOp(t.status, "waiting_approval")
        ),
    });
    if (waiting) {
      await db
        .update(workflowExecutionLogs)
        .set({
          status: "success",
          output: { approved: input.approved, note: input.note },
          completedAt: new Date(),
        })
        .where(eq(workflowExecutionLogs.id, waiting.id));
    }
    return { logged: true };
  } catch (error) {
    console.error("[Approval] Failed to record approval decision:", error);
    return { logged: false };
  }
}
