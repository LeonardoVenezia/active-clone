import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { graphFetch, NOT_CONFIGURED_ERROR, normalizeRecipient } from "../api";
import type { WhatsAppCredentials } from "../credentials";

type Result =
  | { success: true; templates: Array<{ name: string; language: string; status: string; category: string }>; count: number }
  | { success: false; error: string };

type Input = StepInput & { integrationId?: string };

async function stepHandler(_input: Input, credentials: WhatsAppCredentials): Promise<Result> {
  const accessToken = credentials.WHATSAPP_ACCESS_TOKEN;
  const wabaId = credentials.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!(accessToken && wabaId)) {
    return { success: false, error: "WhatsApp access token or business account ID is not configured. Please add them in Project Integrations." };
  }
  try {
    const result = await graphFetch(accessToken, `/${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category&limit=100`);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const data = (result.data.data ?? []) as Array<{ name: string; language: string; status: string; category: string }>;
    const templates = data.map((template) => ({
      name: template.name,
      language: template.language,
      status: template.status,
      category: template.category,
    }));
    return { success: true, templates, count: templates.length };
  } catch (error) {
    return { success: false, error: `Failed to list templates: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listTemplatesStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listTemplatesStep.maxRetries = 0;

export const _integrationType = "whatsapp";
