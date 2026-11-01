/**
 * Execution status steps - record failures that happen before the step
 * machinery runs, so a refused start never leaves a pending row behind.
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutions } from "@/lib/db/schema";

export async function markExecutionStartErrorStep(input: {
  executionId?: string;
  error: string;
}): Promise<{ marked: boolean }> {
  "use step";

  if (!input.executionId) return { marked: false };
  try {
    await db
      .update(workflowExecutions)
      .set({
        status: "error",
        error: input.error,
        completedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, input.executionId));
    return { marked: true };
  } catch (err) {
    console.error("[executionStatus] Failed to mark start error:", err);
    return { marked: false };
  }
}
