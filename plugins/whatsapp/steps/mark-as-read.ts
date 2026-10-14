import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { graphFetch, NOT_CONFIGURED_ERROR, normalizeRecipient } from "../api";
import type { WhatsAppCredentials } from "../credentials";

type Result = { success: true; messageId: string } | { success: false; error: string };

type Input = StepInput & { messageId: string; integrationId?: string };

async function stepHandler(input: Input, credentials: WhatsAppCredentials): Promise<Result> {
  const accessToken = credentials.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = credentials.WHATSAPP_PHONE_NUMBER_ID;
  if (!(accessToken && phoneNumberId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const messageId = input.messageId?.toString().trim();
  if (!messageId) {
    return { success: false, error: "Message ID is required" };
  }
  try {
    const result = await graphFetch(accessToken, `/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      body: { messaging_product: "whatsapp", status: "read", message_id: messageId },
    });
    return result.ok ? { success: true, messageId } : { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: `Failed to mark as read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function markAsReadStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
markAsReadStep.maxRetries = 0;

export const _integrationType = "whatsapp";
