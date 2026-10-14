import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasAlegraCredentials, NOT_CONFIGURED_ERROR, alegraGet } from "../api";
import type { AlegraCredentials } from "../credentials";

type Result = { success: true; count: number; contacts: Array<Record<string, unknown>> } | { success: false; error: string };
type Input = StepInput & { query?: string; type?: string; limit?: string; integrationId?: string };

async function stepHandler(input: Input, credentials: AlegraCredentials): Promise<Result> {
  if (!hasAlegraCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const data = await alegraGet(credentials, "contacts", {
      query: input.query?.toString().trim(),
      type: input.type?.toString().trim(),
      limit: input.limit?.toString().trim(),
    });
    const contacts = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    return { success: true, count: contacts.length, contacts };
  } catch (error) {
    return { success: false, error: `Failed to list contacts: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listContactsStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listContactsStep.maxRetries = 0;

export const _integrationType = "alegra";
