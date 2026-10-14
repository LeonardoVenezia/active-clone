import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
} from "../registry";

// Signature: https://tiendanube.github.io/api-documentation/resources/webhook
// Header x-linkedstore-hmac-sha256 = HMAC-SHA256(raw body, app client secret), hex.
// The secret belongs to our Tiendanube app (one for all stores), so it is an
// environment variable, not a per-connection credential.

type TiendanubeNotification = {
  store_id?: number | string;
  event?: string;
  id?: number | string;
};

// Tiendanube webhooks carry no event id and may repeat. Repeats of the same
// event for the same resource inside this window count as one.
const DEDUPE_WINDOW_MS = 30_000;

const EVENT_TO_TRIGGER: Record<string, string> = {
  "order/created": "order-created",
  "order/paid": "order-paid",
  "order/cancelled": "order-cancelled",
  "product/updated": "product-updated",
};

function readNotification(rawBody: string): TiendanubeNotification {
  return JSON.parse(rawBody) as TiendanubeNotification;
}

export const tiendanubeWebhook: IntegrationWebhookHandler = {
  verify(request, credentials) {
    const secret = process.env.TIENDANUBE_APP_SECRET;
    if (!secret) {
      return "app secret not configured";
    }

    const header = request.headers.get("x-linkedstore-hmac-sha256");
    if (!header) {
      return "missing signature";
    }
    const expected = createHmac("sha256", secret)
      .update(request.rawBody)
      .digest();
    const received = Buffer.from(header.trim(), "hex");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return "signature mismatch";
    }

    // The signature only proves the event came from Tiendanube. Make sure it
    // is for the store this connection belongs to.
    let notification: TiendanubeNotification;
    try {
      notification = readNotification(request.rawBody);
    } catch {
      return "invalid body";
    }
    if (
      !credentials.TIENDANUBE_STORE_ID ||
      String(notification.store_id) !== credentials.TIENDANUBE_STORE_ID
    ) {
      return "store mismatch";
    }
    return null;
  },

  parse(request) {
    const notification = readNotification(request.rawBody);
    const trigger = notification.event
      ? EVENT_TO_TRIGGER[notification.event]
      : undefined;
    if (!(trigger && notification.id)) {
      return [];
    }
    const resourceId = String(notification.id);
    const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
    const event: IntegrationWebhookEvent = {
      externalId: `${notification.event}:${resourceId}:${bucket}`,
      trigger,
      data: {
        event: notification.event,
        resourceId,
        ...(notification.event?.startsWith("order/")
          ? { orderId: resourceId }
          : { productId: resourceId }),
        storeId: String(notification.store_id),
      },
    };
    return [event];
  },
};
