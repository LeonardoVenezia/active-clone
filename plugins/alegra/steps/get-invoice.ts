import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasAlegraCredentials, NOT_CONFIGURED_ERROR, alegraGet } from "../api";
import type { AlegraCredentials } from "../credentials";

type Result = { success: true; invoice: Record<string, unknown> } | { success: false; error: string };
type Input = StepInput & { invoiceId: string; integrationId?: string };

async function stepHandler(input: Input, credentials: AlegraCredentials): Promise<Result> {
  if (!hasAlegraCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const id = input.invoiceId?.toString().trim();
  if (!id) {
    return { success: false, error: "Invoice ID is required" };
  }
  try {
    const invoice = (await alegraGet(credentials, `invoices/${encodeURIComponent(id)}`)) as Record<string, unknown>;
    return { success: true, invoice };
  } catch (error) {
    return { success: false, error: `Failed to get invoice: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getInvoiceStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getInvoiceStep.maxRetries = 0;

export const _integrationType = "alegra";
