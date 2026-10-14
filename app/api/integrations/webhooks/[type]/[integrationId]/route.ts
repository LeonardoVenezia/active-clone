import { NextResponse } from "next/server";
import { receiveIntegrationWebhook } from "@/lib/integration-webhooks";

export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ type: string; integrationId: string }> }
) {
  const { type, integrationId } = await context.params;
  try {
    const result = await receiveIntegrationWebhook(
      type,
      integrationId,
      request
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[Integration Webhook] Failed:", error);
    // 5xx makes the provider retry later.
    return NextResponse.json({ error: "Processing failed" }, { status: 503 });
  }
}
