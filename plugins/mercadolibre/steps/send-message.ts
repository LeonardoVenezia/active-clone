import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; orderId: string; packId: string; messageId: string }
  | { success: false; error: string };

export type SendMessageInput = StepInput & {
  orderId: string;
  text: string;
  integrationId?: string;
};

type MlOrder = {
  id?: number;
  pack_id?: number | null;
  buyer?: { id?: number };
};

async function stepHandler(
  input: SendMessageInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const orderId = input.orderId?.toString().trim();
  const text = input.text?.toString().trim();
  if (!orderId) {
    return { success: false, error: "Order ID is required" };
  }
  if (!text) {
    return { success: false, error: "Message text is required" };
  }
  const sellerId = credentials.MERCADOLIBRE_USER_ID;
  if (!sellerId) {
    return { success: false, error: "Mercado Libre user ID is missing. Reconnect the account." };
  }
  try {
    const orderResult = await mlFetch(
      input.integrationId,
      credentials,
      `/orders/${encodeURIComponent(orderId)}`
    );
    if (!orderResult.ok) {
      return { success: false, error: orderResult.error };
    }
    const order = orderResult.data as MlOrder;
    const packId = order.pack_id ? String(order.pack_id) : orderId;
    const buyerId = order.buyer?.id;
    if (!buyerId) {
      return { success: false, error: "Order has no buyer to message" };
    }
    const sendResult = await mlFetch(
      input.integrationId,
      credentials,
      `/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(sellerId)}`,
      {
        method: "POST",
        body: {
          from: { user_id: Number(sellerId) },
          to: { user_id: buyerId },
          text,
        },
      }
    );
    if (!sendResult.ok) {
      return { success: false, error: sendResult.error };
    }
    const sent = sendResult.data as { id?: string } | null;
    return {
      success: true,
      orderId,
      packId,
      messageId: sent?.id ? String(sent.id) : "",
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function sendMessageStep(input: SendMessageInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
sendMessageStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
