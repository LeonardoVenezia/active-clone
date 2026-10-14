import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
} from "../registry";

// Webhook format and signature adapted from the MIT-licensed Activepieces
// WhatsApp piece. Meta signs the raw body with the APP SECRET:
// X-Hub-Signature-256: sha256=<hex>. Meta also verifies the URL once with
// GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...

type WhatsAppValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: Array<{
    id: string;
    from: string;
    timestamp?: string;
    type: string;
    text?: { body?: string };
    button?: { text?: string; payload?: string };
    interactive?: {
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
    image?: { id?: string; caption?: string };
    document?: { id?: string; caption?: string; filename?: string };
    audio?: { id?: string };
    video?: { id?: string; caption?: string };
  }>;
  statuses?: Array<{
    id: string;
    status: string;
    recipient_id?: string;
    timestamp?: string;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
};

type WhatsAppBody = {
  entry?: Array<{ changes?: Array<{ field?: string; value?: WhatsAppValue }> }>;
};

function readBody(rawBody: string): WhatsAppBody {
  return JSON.parse(rawBody) as WhatsAppBody;
}

function values(body: WhatsAppBody): WhatsAppValue[] {
  return (body.entry ?? []).flatMap((entry) =>
    (entry.changes ?? [])
      .filter((change) => change.field === "messages" && change.value)
      .map((change) => change.value as WhatsAppValue)
  );
}

function toIso(unixSeconds?: string): string {
  const seconds = Number(unixSeconds);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : "";
}

export const whatsappWebhook: IntegrationWebhookHandler = {
  handshake(query, credentials) {
    if (query.get("hub.mode") !== "subscribe") {
      return null;
    }
    const expected = credentials.WHATSAPP_VERIFY_TOKEN;
    if (!expected || query.get("hub.verify_token") !== expected) {
      return { status: 403, body: "verify token mismatch" };
    }
    return { status: 200, body: query.get("hub.challenge") ?? "" };
  },

  verify(request, credentials) {
    const appSecret = credentials.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      // Unsigned deliveries are not accepted: anyone with the URL could
      // otherwise start the owner's workflows.
      return "app secret not configured";
    }
    const header = request.headers.get("x-hub-signature-256");
    if (!header?.startsWith("sha256=")) {
      return "missing signature";
    }
    const expected = createHmac("sha256", appSecret)
      .update(request.rawBody)
      .digest();
    const received = Buffer.from(header.slice("sha256=".length), "hex");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return "signature mismatch";
    }
    return null;
  },

  parse(request, credentials) {
    const events: IntegrationWebhookEvent[] = [];
    const phoneNumberId = credentials.WHATSAPP_PHONE_NUMBER_ID;
    for (const value of values(readBody(request.rawBody))) {
      // One Meta app can serve several numbers; keep this connection's own.
      if (phoneNumberId && value.metadata?.phone_number_id !== phoneNumberId) {
        continue;
      }
      for (const message of value.messages ?? []) {
        const contact =
          value.contacts?.find((entry) => entry.wa_id === message.from) ??
          value.contacts?.[0];
        const media = message.image ?? message.video ?? message.document;
        const reply =
          message.interactive?.button_reply ?? message.interactive?.list_reply;
        events.push({
          externalId: message.id,
          trigger: "incoming-message",
          data: {
            messageId: message.id,
            from: message.from,
            contactName: contact?.profile?.name ?? "",
            type: message.type,
            text:
              message.text?.body ??
              message.button?.text ??
              reply?.title ??
              media?.caption ??
              "",
            replyId: reply?.id ?? message.button?.payload ?? "",
            mediaId: message.image?.id ?? message.document?.id ?? message.video?.id ?? message.audio?.id ?? "",
            receivedAt: toIso(message.timestamp),
            phoneNumberId: value.metadata?.phone_number_id ?? "",
          },
        });
      }
      for (const status of value.statuses ?? []) {
        const error = status.errors?.[0];
        events.push({
          externalId: `${status.id}:${status.status}`,
          trigger: "message-status-updated",
          data: {
            messageId: status.id,
            status: status.status,
            recipient: status.recipient_id ?? "",
            updatedAt: toIso(status.timestamp),
            errorCode: error?.code ?? "",
            errorMessage: error?.message ?? error?.title ?? "",
            phoneNumberId: value.metadata?.phone_number_id ?? "",
          },
        });
      }
    }
    return events;
  },
};
