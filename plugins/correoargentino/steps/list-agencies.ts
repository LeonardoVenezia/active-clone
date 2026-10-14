import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { correoRequest, hasCorreoCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { CorreoArgentinoCredentials } from "../credentials";

type Result =
  | { success: true; count: number; agencies: Array<Record<string, unknown>> }
  | { success: false; error: string };
type Input = StepInput & { provinceCode: string; integrationId?: string };

async function stepHandler(input: Input, credentials: CorreoArgentinoCredentials): Promise<Result> {
  if (!hasCorreoCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const provinceCode = input.provinceCode?.toString().trim().toUpperCase();
  if (!provinceCode) {
    return { success: false, error: "Province code is required (for example B for Buenos Aires)" };
  }
  try {
    const data = await correoRequest(credentials, "GET", "/agencies", {
      query: { customerId: credentials.CORREO_ARGENTINO_CUSTOMER_ID ?? "", provinceCode },
    });
    const agencies = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    return { success: true, count: agencies.length, agencies };
  } catch (error) {
    return { success: false, error: `Failed to list agencies: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listAgenciesStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listAgenciesStep.maxRetries = 0;

export const _integrationType = "correoargentino";
