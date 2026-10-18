import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasZipnovaCredentials, NOT_CONFIGURED_ERROR, zipnovaRequest } from "../api";
import type { ZipnovaCredentials } from "../credentials";

type Result = { success: true; tracking: unknown } | { success: false; error: string };
type Input = StepInput & { shipmentId: string; sort?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: ZipnovaCredentials): Promise<Result> {
  if (!hasZipnovaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.shipmentId) return { success: false, error: "shipmentId is required" };
  try {
    const tracking = await zipnovaRequest(credentials, "GET", `/shipments/${input.shipmentId}/tracking`, undefined, {
      sort: input.sort,
    });
    return { success: true, tracking };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function zipnovaGetTracking(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
zipnovaGetTracking.maxRetries = 0;

export const _integrationType = "zipnova";
