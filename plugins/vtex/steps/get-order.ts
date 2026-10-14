import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasVtexCredentials, NOT_CONFIGURED_ERROR, readVtexError, vtexBaseUrl, vtexHeaders } from "../api";
import type { VtexCredentials } from "../credentials";

type Result =
  | { success: true; orderId: string; status: string; statusDescription: string; value: number; creationDate: string; customerName: string; customerEmail: string; items: Array<{ id: string; name: string; quantity: number; price: number }>; order: Record<string, unknown> }
  | { success: false; error: string };

type Input = StepInput & { orderId: string; integrationId?: string };

type VtexOrder = {
  orderId: string;
  status: string;
  statusDescription?: string;
  value: number;
  creationDate?: string;
  clientProfileData?: { firstName?: string; lastName?: string; email?: string };
  items?: Array<{ id: string; name: string; quantity: number; price: number }>;
};

// VTEX money values (value, price) are integers in cents.
async function stepHandler(input: Input, credentials: VtexCredentials): Promise<Result> {
  if (!hasVtexCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const orderId = input.orderId?.toString().trim();
  if (!orderId) {
    return { success: false, error: "Order ID is required" };
  }
  try {
    const response = await fetch(`${vtexBaseUrl(credentials)}/api/oms/pvt/orders/${encodeURIComponent(orderId)}`, {
      headers: vtexHeaders(credentials),
    });
    if (!response.ok) {
      return { success: false, error: await readVtexError(response, "Failed to get order") };
    }
    const order = (await response.json()) as VtexOrder;
    return {
      success: true,
      orderId: order.orderId,
      status: order.status,
      statusDescription: order.statusDescription ?? "",
      value: order.value,
      creationDate: order.creationDate ?? "",
      customerName: [order.clientProfileData?.firstName, order.clientProfileData?.lastName].filter(Boolean).join(" "),
      customerEmail: order.clientProfileData?.email ?? "",
      items: (order.items ?? []).map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, price: item.price })),
      order: order as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return { success: false, error: `Failed to get order: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getOrderStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getOrderStep.maxRetries = 0;

export const _integrationType = "vtex";
