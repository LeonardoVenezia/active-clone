import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasAlegraCredentials, NOT_CONFIGURED_ERROR, alegraGet } from "../api";
import type { AlegraCredentials } from "../credentials";

type Result = { success: true; company: Record<string, unknown> } | { success: false; error: string };
type Input = StepInput & {  integrationId?: string };

async function stepHandler(input: Input, credentials: AlegraCredentials): Promise<Result> {
  if (!hasAlegraCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const company = (await alegraGet(credentials, "company")) as Record<string, unknown>;
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

export const _integrationType = "alegra";
