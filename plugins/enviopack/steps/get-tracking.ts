import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { enviopackGet, enviopackGetBytes, enviopackPost, hasEnviopackCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { EnviopackCredentials } from "../credentials";

type Result = { success: true; tracking: unknown } | { success: false; error: string };
type Input = StepInput & { shipmentId: string; dateFormat?: string; order?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: EnviopackCredentials): Promise<Result> {
  if (!hasEnviopackCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.shipmentId) return { success: false, error: "shipmentId is required" };
  try {
    const tracking = await enviopackGet(credentials, `/envios/${input.shipmentId}/tracking`, {
      formato: input.dateFormat,
      orden: input.order,
    });
    return { success: true, tracking };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function enviopackGetTracking(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
enviopackGetTracking.maxRetries = 0;

export const _integrationType = "enviopack";
