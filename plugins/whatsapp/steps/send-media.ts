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
  mediaType?: string;
  mediaUrl?: string;
  caption?: string;
  filename?: string;
  integrationId?: string;
};

const MEDIA_TYPES = ["image", "document", "audio", "video"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

// Sends media by public URL (Meta fetches it). Same 24-hour window rule as
// free-form text: outside it Meta rejects the send, use Send Template.
async function stepHandler(input: Input, credentials: WhatsAppCredentials): Promise<Result> {
  const accessToken = credentials.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = credentials.WHATSAPP_PHONE_NUMBER_ID;
  if (!(accessToken && phoneNumberId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const to = normalizeRecipient(input.to?.toString() ?? "");
  if (!to) {
    return { success: false, error: "Recipient phone number is required (international format, e.g. 5491112345678)" };
  }
  const mediaType = (input.mediaType?.toString().toLowerCase() || "image") as MediaType;
  if (!MEDIA_TYPES.includes(mediaType)) {
    return { success: false, error: `Media type must be one of: ${MEDIA_TYPES.join(", ")}` };
  }
  const mediaUrl = input.mediaUrl?.toString().trim();
  if (!mediaUrl) {
    return { success: false, error: "Media URL is required (a public https URL Meta can fetch)" };
  }
  if (!/^https:\/\//i.test(mediaUrl)) {
    return { success: false, error: "Media URL must be a public https URL" };
  }
  const caption = input.caption?.toString();
  const filename = input.filename?.toString();
  const media: Record<string, string> = { link: mediaUrl };
  if (caption && mediaType !== "audio") {
    media.caption = caption;
  }
  if (filename && mediaType === "document") {
    media.filename = filename;
  }
  try {
    const result = await graphFetch(accessToken, `/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: mediaType,
        [mediaType]: media,
      },
    });
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const messages = result.data.messages as Array<{ id: string }> | undefined;
    return { success: true, messageId: messages?.[0]?.id ?? "", to };
  } catch (error) {
    return { success: false, error: `Failed to send media: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function sendMediaStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
sendMediaStep.maxRetries = 0;

export const _integrationType = "whatsapp";
