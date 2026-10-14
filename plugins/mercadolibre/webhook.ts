import type {
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
} from "../registry";

// https://developers.mercadolibre.com.ar/es_ar/notificaciones
// Mercado Libre notifications are not signed. They carry only the resource
// path, so we (1) keep the connection id in the URL secret, (2) require
// user_id to match the connected seller, and (3) pass only IDs downstream;
// actions read the real data from the API with the seller's token.

type MercadoLibreNotification = {
  _id?: string;
  resource?: string;
  user_id?: number | string;
  topic?: string;
  actions?: string[];
  sent?: string;
  attempts?: number;
};

const TOPIC_TO_TRIGGER: Record<string, string> = {
  orders_v2: "order-updated",
  questions: "question-received",
};

function readNotification(rawBody: string): MercadoLibreNotification {
  return JSON.parse(rawBody) as MercadoLibreNotification;
}

export const mercadolibreWebhook: IntegrationWebhookHandler = {
  verify(request, credentials) {
    let notification: MercadoLibreNotification;
    try {
      notification = readNotification(request.rawBody);
    } catch {
      return "invalid body";
    }
    if (
      !credentials.MERCADOLIBRE_USER_ID ||
      String(notification.user_id) !== credentials.MERCADOLIBRE_USER_ID
    ) {
      return "user mismatch";
    }
    return null;
  },

  parse(request) {
    const notification = readNotification(request.rawBody);
    const trigger = notification.topic
      ? TOPIC_TO_TRIGGER[notification.topic]
      : undefined;
    const resourceId = notification.resource?.split("/").filter(Boolean).pop();
    if (!(trigger && resourceId)) {
      return [];
    }
    // Retries of the same notification share topic, resource and sent time.
    const event: IntegrationWebhookEvent = {
      externalId:
        notification._id ??
        `${notification.topic}:${resourceId}:${notification.sent ?? ""}`,
      trigger,
      data: {
        topic: notification.topic ?? "",
        resourceId,
        ...(trigger === "order-updated"
          ? { orderId: resourceId }
          : { questionId: resourceId }),
        userId: String(notification.user_id),
      },
    };
    return [event];
  },
};
