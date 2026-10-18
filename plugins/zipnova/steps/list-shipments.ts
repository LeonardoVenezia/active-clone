import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasZipnovaCredentials, NOT_CONFIGURED_ERROR, zipnovaRequest } from "../api";
import type { ZipnovaCredentials } from "../credentials";

type Result = { success: true; shipments: unknown } | { success: false; error: string };
type Input = StepInput & {
  externalId?: string;
  status?: string;
  carrierId?: string;
  serviceType?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: ZipnovaCredentials): Promise<Result> {
  if (!hasZipnovaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const shipments = await zipnovaRequest(credentials, "GET", "/shipments", undefined, {
      account_id: credentials.ZIPNOVA_ACCOUNT_ID,
      external_id: input.externalId,
      status: input.status,
      carrier_id: input.carrierId,
      service_type: input.serviceType,
    });
    return { success: true, shipments };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function zipnovaListShipments(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
zipnovaListShipments.maxRetries = 0;

export const _integrationType = "zipnova";
