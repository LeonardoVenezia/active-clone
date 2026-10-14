import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasAlegraCredentials, NOT_CONFIGURED_ERROR, alegraGet } from "../api";
import type { AlegraCredentials } from "../credentials";

type Result = { success: true; count: number; invoices: Array<Record<string, unknown>> } | { success: false; error: string };
type Input = StepInput & { start?: string; limit?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: AlegraCredentials): Promise<Result> {
  if (!hasAlegraCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const data = await alegraGet(credentials, "invoices", {
      start: input.start?.toString().trim(),
      limit: input.limit?.toString().trim(),
    });
    const invoices = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    return { success: true, count: invoices.length, invoices };
  } catch (error) {
    return { success: false, error: `Failed to list invoices: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listInvoicesStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listInvoicesStep.maxRetries = 0;

export const _integrationType = "alegra";
