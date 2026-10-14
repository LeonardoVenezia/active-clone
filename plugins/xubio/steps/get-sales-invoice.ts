import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasXubioCredentials, NOT_CONFIGURED_ERROR, xubioGet } from "../api";
import type { XubioCredentials } from "../credentials";

type Result = { success: true; invoice: Record<string, unknown> } | { success: false; error: string };
type Input = StepInput & { invoiceId: string; integrationId?: string };

async function stepHandler(input: Input, credentials: XubioCredentials): Promise<Result> {
  if (!hasXubioCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const id = input.invoiceId?.toString().trim();
  if (!id) {
    return { success: false, error: "Invoice ID is required" };
  }
  try {
    const invoice = (await xubioGet(credentials, `comprobanteVentaBean/${encodeURIComponent(id)}`)) as Record<string, unknown>;
    return { success: true, invoice };
  } catch (error) {
    return { success: false, error: `Failed to get sales invoice: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getSalesInvoiceStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getSalesInvoiceStep.maxRetries = 0;

export const _integrationType = "xubio";
