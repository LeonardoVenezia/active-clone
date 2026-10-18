import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { enviopackGet, enviopackGetBytes, enviopackPost, hasEnviopackCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { EnviopackCredentials } from "../credentials";

type Result =
  | { success: true; format: string; base64: string; contentType: string }
  | { success: false; error: string };
type Input = StepInput & { shipmentId: string; format?: string; packageNumber?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: EnviopackCredentials): Promise<Result> {
  if (!hasEnviopackCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.shipmentId) return { success: false, error: "shipmentId is required" };
  const format = input.format || "pdf";
  try {
    const result = await enviopackGetBytes(credentials, `/envios/${input.shipmentId}/etiqueta`, {
      formato: format,
      bulto: input.packageNumber,
    });
    return { success: true, format, ...result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getLabelStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getLabelStep.maxRetries = 0;

export const _integrationType = "enviopack";
