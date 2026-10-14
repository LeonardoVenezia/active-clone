import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; order: Record<string, unknown>; id: string; status: string; total: number; currency: string; buyerNickname: string; items: Array<{ itemId: string; title: string; quantity: number; unitPrice: number }>; shippingId: string; dateCreated: string }
  | { success: false; error: string };

export type GetOrderInput = StepInput & { orderId: string; integrationId?: string };

type MlOrder = {
  id: number;
  status: string;
  total_amount?: number;
  currency_id?: string;
  date_created?: string;
  buyer?: { nickname?: string };
  shipping?: { id?: number };
  order_items?: Array<{ item: { id: string; title: string }; quantity: number; unit_price: number }>;
};

async function stepHandler(
  input: GetOrderInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const orderId = input.orderId?.toString().trim();
  if (!orderId) {
    return { success: false, error: "Order ID is required" };
  }
  try {
    const result = await mlFetch(input.integrationId, credentials, `/orders/${encodeURIComponent(orderId)}`);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const order = result.data as MlOrder;
    return {
      success: true,
      order: order as unknown as Record<string, unknown>,
      id: String(order.id),
      status: order.status,
      total: order.total_amount ?? 0,
      currency: order.currency_id ?? "",
      buyerNickname: order.buyer?.nickname ?? "",
      items: (order.order_items ?? []).map((line) => ({
        itemId: line.item.id,
        title: line.item.title,
        quantity: line.quantity,
        unitPrice: line.unit_price,
      })),
      shippingId: order.shipping?.id ? String(order.shipping.id) : "",
      dateCreated: order.date_created ?? "",
    };
  } catch (error) {
    return { success: false, error: `Failed to get order: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getOrderStep(input: GetOrderInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getOrderStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
