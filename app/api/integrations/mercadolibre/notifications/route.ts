import { NextResponse } from "next/server";
import { getIntegrationsByType } from "@/lib/db/integrations";
import { receiveIntegrationWebhook } from "@/lib/integration-webhooks";

export const maxDuration = 60;

/**
 * POST /api/integrations/mercadolibre/notifications
 * Mercado Libre has ONE callback URL per app, so every seller's notifications
 * arrive here. We route each one to the connection(s) whose user_id matches.
 * The shared handler then re-checks user_id before storing anything.
 */
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let userId = "";
    try {
      userId = String((JSON.parse(rawBody) as { user_id?: unknown }).user_id);
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const connections = (await getIntegrationsByType("mercadolibre")).filter(
      (integration) => String(integration.config.userId) === userId
    );
    // Unknown seller: acknowledge so Mercado Libre does not keep retrying.
    if (connections.length === 0) {
      return NextResponse.json({ received: true, matched: 0 });
    }

    for (const connection of connections) {
      await receiveIntegrationWebhook(
        "mercadolibre",
        connection.id,
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: rawBody,
        })
      );
    }
    return NextResponse.json({ received: true, matched: connections.length });
  } catch (error) {
    console.error("[Mercado Libre Notifications] Failed:", error);
    return NextResponse.json({ error: "Processing failed" }, { status: 503 });
  }
}
