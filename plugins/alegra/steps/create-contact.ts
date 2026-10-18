import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { alegraPost, hasAlegraCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { AlegraCredentials } from "../credentials";

type Result =
  | { success: true; id: string; name: string }
  | { success: false; error: string };

type Input = StepInput & {
  name?: string;
  identification?: string;
  email?: string;
  phonePrimary?: string;
  mobile?: string;
  type?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: AlegraCredentials): Promise<Result> {
  if (!hasAlegraCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const name = input.name?.toString().trim();
  if (!name) {
    return { success: false, error: "Contact name is required" };
  }
  const body: Record<string, unknown> = { name };
  const identification = input.identification?.toString().trim();
  if (identification) {
    body.identification = identification;
  }
  const email = input.email?.toString().trim();
  if (email) {
    body.email = email;
  }
  const phonePrimary = input.phonePrimary?.toString().trim();
  if (phonePrimary) {
    body.phonePrimary = phonePrimary;
  }
  const mobile = input.mobile?.toString().trim();
  if (mobile) {
    body.mobile = mobile;
  }
  const type = input.type?.toString().trim().toLowerCase();
  if (type) {
    if (!["client", "provider"].includes(type)) {
      return { success: false, error: "Type must be 'client' or 'provider'" };
    }
    body.type = [type];
  }
  try {
    const data = (await alegraPost(credentials, "contacts", body)) as { id?: number | string; name?: string };
    return { success: true, id: String(data.id ?? ""), name: data.name ?? name };
  } catch (error) {
    return { success: false, error: `Failed to create contact: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function createContactStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
createContactStep.maxRetries = 0;

export const _integrationType = "alegra";
