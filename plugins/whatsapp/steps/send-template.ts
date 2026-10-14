import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { graphFetch, NOT_CONFIGURED_ERROR, normalizeRecipient } from "../api";
import type { WhatsAppCredentials } from "../credentials";

type Result =
  | { success: true; messageId: string; to: string }
  | { success: false; error: string };

type Input = StepInput & {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParameters?: string;
  integrationId?: string;
};

// Templates must be approved by Meta first. Body parameters fill {{1}}, {{2}}
// in order; here they come as one value per line.
async function stepHandler(input: Input, credentials: WhatsAppCredentials): Promise<Result> {
  const accessToken = credentials.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = credentials.WHATSAPP_PHONE_NUMBER_ID;
  if (!(accessToken && phoneNumberId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const to = normalizeRecipient(input.to?.toString() ?? "");
  const name = input.templateName?.toString().trim();
  if (!to) {
    return { success: false, error: "Recipient phone number is required (international format, e.g. 5491112345678)" };
  }
  if (!name) {
    return { success: false, error: "Template name is required" };
  }
  const parameters = (input.bodyParameters?.toString() ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ type: "text", text }));
  try {
    const result = await graphFetch(accessToken, `/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name,
          language: { code: input.languageCode?.toString().trim() || "es_AR" },
          ...(parameters.length > 0 ? { components: [{ type: "body", parameters }] } : {}),
        },
      },
    });
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const messages = result.data.messages as Array<{ id: string }> | undefined;
    return { success: true, messageId: messages?.[0]?.id ?? "", to };
  } catch (error) {
    return { success: false, error: `Failed to send template: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function sendTemplateStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
sendTemplateStep.maxRetries = 0;

export const _integrationType = "whatsapp";
