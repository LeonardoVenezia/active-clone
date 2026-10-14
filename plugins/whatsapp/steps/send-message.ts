import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { graphFetch, NOT_CONFIGURED_ERROR, normalizeRecipient } from "../api";
import type { WhatsAppCredentials } from "../credentials";

type Result =
  | { success: true; messageId: string; to: string }
  | { success: false; error: string };

type Input = StepInput & { to: string; text: string; previewUrl?: string; integrationId?: string };

// Free-form text only works inside the 24-hour window after the customer's
// last message. Outside it Meta rejects the send: use Send Template.
async function stepHandler(input: Input, credentials: WhatsAppCredentials): Promise<Result> {
  const accessToken = credentials.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = credentials.WHATSAPP_PHONE_NUMBER_ID;
  if (!(accessToken && phoneNumberId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const to = normalizeRecipient(input.to?.toString() ?? "");
  const text = input.text?.toString();
  if (!to) {
    return { success: false, error: "Recipient phone number is required (international format, e.g. 5491112345678)" };
  }
  if (!text?.trim()) {
    return { success: false, error: "Message text is required" };
  }
  try {
    const result = await graphFetch(accessToken, `/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text, preview_url: input.previewUrl === "true" },
      },
    });
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const messages = result.data.messages as Array<{ id: string }> | undefined;
    return { success: true, messageId: messages?.[0]?.id ?? "", to };
  } catch (error) {
    return { success: false, error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function sendMessageStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
sendMessageStep.maxRetries = 0;

export const _integrationType = "whatsapp";
