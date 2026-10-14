import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
} from "../registry";

// Signature scheme: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
// Manifest layout checked against the official Mercado Pago Node SDK
// (utils/webhook): "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
const MAX_AGE_SECONDS = 15 * 60;

type MercadoPagoNotification = {
  id?: number | string;
  type?: string;
  action?: string;
  live_mode?: boolean;
  data?: { id?: string | number };
};

function parseSignature(header: string): { ts?: string; v1?: string } {
  const result: { ts?: string; v1?: string } = {};
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (key === "ts") {
      result.ts = value;
    } else if (key === "v1") {
      result.v1 = value;
    }
  }
  return result;
}

function readNotification(rawBody: string): MercadoPagoNotification {
  return JSON.parse(rawBody) as MercadoPagoNotification;
}

function dataIdFor(
  query: URLSearchParams,
  notification: MercadoPagoNotification
): string | undefined {
  // MP signs the data.id sent in the query string; lowercase when alphanumeric.
  const raw = query.get("data.id") ?? notification.data?.id;
  return raw === undefined || raw === null || raw === ""
    ? undefined
    : String(raw).toLowerCase();
}

export const mercadoPagoWebhook: IntegrationWebhookHandler = {
  verify(request, credentials) {
    const secret = credentials.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) {
      return "webhook secret not configured";
    }

    const header = request.headers.get("x-signature");
    if (!header) {
      return "missing signature";
    }
    const { ts, v1 } = parseSignature(header);
    if (!(ts && v1) || !/^\d+$/.test(ts)) {
      return "malformed signature";
    }

    let notification: MercadoPagoNotification;
    try {
      notification = readNotification(request.rawBody);
    } catch {
      return "invalid body";
    }

    const parts: string[] = [];
    const dataId = dataIdFor(request.query, notification);
    if (dataId) {
      parts.push(`id:${dataId}`);
    }
    const requestId = request.headers.get("x-request-id");
    if (requestId) {
      parts.push(`request-id:${requestId}`);
    }
    parts.push(`ts:${ts}`);
    const manifest = `${parts.join(";")};`;

    const expected = createHmac("sha256", secret).update(manifest).digest();
    let received: Buffer;
    try {
      received = Buffer.from(v1, "hex");
    } catch {
      return "malformed signature";
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return "signature mismatch";
    }

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts));
    if (ageSeconds > MAX_AGE_SECONDS) {
      return "stale timestamp";
    }
    return null;
  },

  parse(request) {
    const notification = readNotification(request.rawBody);
    const events: IntegrationWebhookEvent[] = [];

    if (notification.type === "payment" && notification.data?.id) {
      const paymentId = String(notification.data.id);
      const action = notification.action ?? "payment.updated";
      events.push({
        // Each notification has its own id; fall back to payment + action.
        externalId: notification.id
          ? `notification-${notification.id}`
          : `${paymentId}-${action}`,
        trigger: "payment-updated",
        data: {
          paymentId,
          action,
          liveMode: notification.live_mode ?? false,
        },
      });
    }

    return events;
  },
};
