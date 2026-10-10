import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutionLogs, workflowExecutions } from "@/lib/db/schema";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";

// Generic: runs ANY Composio tool as the workflow OWNER's own connected account. Reads and writes are both allowed (owner decision).
// Safety kept: owner resolved from the execution record, owner's PRIVATE account only, no retries, per-run cap, errors never echo provider bodies.
const BASE = "https://backend.composio.dev/api/v3";
const SLUG = /^[A-Za-z0-9_]{1,80}$/;
const MAX_STEPS_PER_RUN = 100;
type Row = Record<string, any>;

async function request(path: string, body?: Row): Promise<Row> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY is not configured on the server.");
  const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", cache: "no-store", headers: { "x-api-key": key, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "Composio authentication failed." : r.status === 429 ? "Composio rate limit reached. No automatic retry." : `Composio request failed (HTTP ${r.status}).`);
  return r.json();
}

export async function runComposioToolStep(input: StepInput & { toolkit?: string; tool?: string; arguments?: string | Row; integrationId?: string }) {
  "use step";
  return withStepLogging(input, async () => {
    try {
      const executionId = input._context?.executionId;
      if (!executionId) return { success: false, error: "This action only runs inside a workflow run." };
      const toolkit = String(input.toolkit ?? "").trim().toLowerCase();
      const tool = String(input.tool ?? "").trim().toUpperCase();
      if (!SLUG.test(toolkit) || !SLUG.test(tool)) return { success: false, error: "Set a valid app slug and action slug." };
      let args: Row = {};
      if (input.arguments && String(typeof input.arguments === "string" ? input.arguments : "x").trim()) {
        try { args = typeof input.arguments === "string" ? JSON.parse(input.arguments) : input.arguments; } catch { return { success: false, error: "Arguments must be valid JSON." }; }
        if (!args || typeof args !== "object" || Array.isArray(args)) return { success: false, error: "Arguments must be a JSON object." };
      }
      const [exec] = await db.select({ userId: workflowExecutions.userId }).from(workflowExecutions).where(eq(workflowExecutions.id, executionId)).limit(1);
      if (!exec) return { success: false, error: "Run not found." };
      const logs = await db.select({ id: workflowExecutionLogs.id }).from(workflowExecutionLogs).where(eq(workflowExecutionLogs.executionId, executionId)).limit(MAX_STEPS_PER_RUN + 1);
      if (logs.length > MAX_STEPS_PER_RUN) return { success: false, error: "This run hit the step limit." };
      const userId = exec.userId;
      const accounts = await request(`/connected_accounts?${new URLSearchParams({ user_ids: userId, toolkit_slugs: toolkit, statuses: "ACTIVE", limit: "20" })}`);
      const mine = (accounts.items ?? []).filter((a: Row) => a.user_id === userId && a.status === "ACTIVE" && !a.is_disabled && String(a.toolkit?.slug).toLowerCase() === toolkit && a.experimental?.account_type !== "SHARED");
      const meta = await request(`/tools/${encodeURIComponent(tool)}?toolkit_versions=latest`);
      if (String(meta.toolkit?.slug ?? "").toLowerCase() !== toolkit) return { success: false, error: "That action does not belong to that app." };
      if (!mine.length && meta.no_auth !== true) return { success: false, error: `No connected ${toolkit} account for the workflow owner. Connect it from the chat first.` };
      const r = await request(`/tools/execute/${encodeURIComponent(tool)}`, { user_id: userId, version: meta.version, arguments: args, ...(mine.length ? { connected_account_id: mine[0].id } : {}) });
      if (r.successful !== true) return { success: false, error: "The action returned an unsuccessful result." };
      return { success: true, data: r.data };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Composio action failed." }; }
  });
}
runComposioToolStep.maxRetries = 0;
export const _integrationType = "composio";
