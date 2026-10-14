import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasXubioCredentials, NOT_CONFIGURED_ERROR, xubioGet } from "../api";
import type { XubioCredentials } from "../credentials";

type Result = { success: true; count: number; invoices: Array<Record<string, unknown>> } | { success: false; error: string };
type Input = StepInput & { fromDate?: string; toDate?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: XubioCredentials): Promise<Result> {
  if (!hasXubioCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const data = await xubioGet(credentials, "comprobanteVentaBean", {
      fechaDesde: input.fromDate?.toString().trim(),
      fechaHasta: input.toDate?.toString().trim(),
    });
    const invoices = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    return { success: true, count: invoices.length, invoices };
  } catch (error) {
    return { success: false, error: `Failed to list sales invoices: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listSalesInvoicesStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listSalesInvoicesStep.maxRetries = 0;

export const _integrationType = "xubio";
