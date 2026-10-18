import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasZipnovaCredentials, NOT_CONFIGURED_ERROR, zipnovaRequest } from "../api";
import type { ZipnovaCredentials } from "../credentials";

type Result = { success: true; result: unknown } | { success: false; error: string };
type Input = StepInput & { shipmentId: string; integrationId?: string };

async function stepHandler(input: Input, credentials: ZipnovaCredentials): Promise<Result> {
  if (!hasZipnovaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.shipmentId) return { success: false, error: "shipmentId is required" };
  try {
    const result = await zipnovaRequest(credentials, "POST", `/shipments/${input.shipmentId}/cancel`);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function zipnovaCancelShipment(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
zipnovaCancelShipment.maxRetries = 0;

export const _integrationType = "zipnova";
