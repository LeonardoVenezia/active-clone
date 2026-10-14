import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasXubioCredentials, NOT_CONFIGURED_ERROR, xubioGet } from "../api";
import type { XubioCredentials } from "../credentials";

type Result = { success: true; company: Record<string, unknown> } | { success: false; error: string };
type Input = StepInput & {  integrationId?: string };

async function stepHandler(input: Input, credentials: XubioCredentials): Promise<Result> {
  if (!hasXubioCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const company = (await xubioGet(credentials, "miempresa")) as Record<string, unknown>;
    return { success: true, company };
  } catch (error) {
    return { success: false, error: `Failed to get company: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getCompanyStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getCompanyStep.maxRetries = 0;

export const _integrationType = "xubio";
