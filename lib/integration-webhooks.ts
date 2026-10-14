import "server-only";

import { db } from "@/lib/db";
import { getIntegrationById } from "@/lib/db/integrations";
import { integrationEvents } from "@/lib/db/schema";
import { getCredentialMapping, getIntegration } from "@/plugins";
import type { IntegrationType } from "@/lib/types/integration";

const MAX_BODY_BYTES = 1024 * 1024;

export type IntegrationWebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Receive a webhook for one integration connection.
 *
 * Flow: find the connection -> verify the provider signature -> normalize the
 * payload into events -> store each event once (retries are dropped).
 *
 * This only records events. Starting workflows from them is a separate step
 * that needs the workflow "active" flag (not built yet), so nothing runs here.
 */
export async function receiveIntegrationWebhook(
  type: string,
  integrationId: string,
  request: Request
): Promise<IntegrationWebhookResult> {
  const plugin = getIntegration(type as IntegrationType);
  if (!plugin?.webhook) {
    return { status: 404, body: { error: "Webhooks not supported" } };
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "Payload too large" } };
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "Payload too large" } };
  }

  // Same response for "no such connection" and "wrong type" so ids can't be probed.
  const integration = await getIntegrationById(integrationId);
  if (!integration || integration.type !== type) {
    return { status: 404, body: { error: "Not found" } };
  }

  const credentials = getCredentialMapping(
    plugin,
    integration.config as Record<string, unknown>
  );
  const webhookRequest = {
    headers: request.headers,
    rawBody,
    query: new URL(request.url).searchParams,
  };

  const handler = await plugin.webhook.getHandler();

  const rejection = handler.verify(webhookRequest, credentials);
  if (rejection) {
    console.warn("[Integration Webhook] Rejected", type, rejection);
    return { status: 401, body: { error: "Invalid signature" } };
  }

  let events: ReturnType<typeof handler.parse>;
  try {
    events = handler.parse(webhookRequest, credentials);
  } catch {
    return { status: 400, body: { error: "Invalid payload" } };
  }

  let stored = 0;
  for (const event of events) {
    const inserted = await db
      .insert(integrationEvents)
      .values({
        integrationId: integration.id,
        userId: integration.userId,
        type,
        trigger: event.trigger,
        externalId: event.externalId,
        data: event.data,
      })
      .onConflictDoNothing()
      .returning({ id: integrationEvents.id });
    stored += inserted.length;
  }

  return {
    status: 200,
    body: { received: events.length, stored },
  };
}
