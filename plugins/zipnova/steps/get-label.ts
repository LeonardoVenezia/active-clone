import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasZipnovaCredentials, NOT_CONFIGURED_ERROR, zipnovaRequest } from "../api";
import type { ZipnovaCredentials } from "../credentials";

type Result =
  | { success: true; what: string; format: string; document: unknown }
  | { success: false; error: string };
type Input = StepInput & {
  shipmentId: string;
  what?: string;
  format?: string;
  noStatusChange?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: ZipnovaCredentials): Promise<Result> {
  if (!hasZipnovaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.shipmentId) return { success: false, error: "shipmentId is required" };
  const what = input.what || "label";
  const format = input.format || "pdf";
  try {
    const document = await zipnovaRequest(
      credentials,
      "GET",
      `/shipments/${input.shipmentId}/${what}.${format}`,
      undefined,
      { no_status_change: input.noStatusChange === "1" ? "1" : undefined }
    );
    return { success: true, what, format, document };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function zipnovaGetLabel(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
zipnovaGetLabel.maxRetries = 0;

export const _integrationType = "zipnova";
