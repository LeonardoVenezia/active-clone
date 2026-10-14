import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasXubioCredentials, NOT_CONFIGURED_ERROR, xubioGet } from "../api";
import type { XubioCredentials } from "../credentials";

type Result = { success: true; count: number; customers: Array<Record<string, unknown>> } | { success: false; error: string };
type Input = StepInput & { name?: string; email?: string; taxId?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: XubioCredentials): Promise<Result> {
  if (!hasXubioCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const data = await xubioGet(credentials, "clienteBean", {
      nombre: input.name?.toString().trim(),
      email: input.email?.toString().trim(),
      numeroIdentificacion: input.taxId?.toString().trim(),
    });
    const customers = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    return { success: true, count: customers.length, customers };
  } catch (error) {
    return { success: false, error: `Failed to list customers: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listCustomersStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listCustomersStep.maxRetries = 0;

export const _integrationType = "xubio";
