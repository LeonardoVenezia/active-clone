import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { enviopackGet, enviopackGetBytes, enviopackPost, hasEnviopackCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { EnviopackCredentials } from "../credentials";

type Result = { success: true; shipment: unknown } | { success: false; error: string };
type Input = StepInput & { shipmentId: string; integrationId?: string };

async function stepHandler(input: Input, credentials: EnviopackCredentials): Promise<Result> {
  if (!hasEnviopackCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.shipmentId) return { success: false, error: "shipmentId is required" };
  try {
    const shipment = await enviopackGet(credentials, `/envios/${input.shipmentId}`, {});
    return { success: true, shipment };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function enviopackGetShipment(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
enviopackGetShipment.maxRetries = 0;

export const _integrationType = "enviopack";
