import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import {
  authHeaders,
  NOT_CONFIGURED_ERROR,
  readTiendanubeError,
  storeUrl,
} from "../api";
import type { TiendanubeCredentials } from "../credentials";

type TiendanubeOrder = {
  id: number;
  number: number;
  status: string;
  payment_status: string;
  shipping_status: string;
  total: string;
  currency: string;
  contact_email?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  owner_note?: string | null;
  created_at?: string;
  products?: Array<{
    product_id: number;
    variant_id: number;
    name: string;
    sku?: string | null;
    quantity: number;
    price: string;
  }>;
};

type GetOrderResult =
  | {
      success: true;
      id: number;
      number: number;
      status: string;
      paymentStatus: string;
      shippingStatus: string;
      total: string;
      currency: string;
      customerEmail: string;
      customerName: string;
      customerPhone: string;
      products: Array<{
        productId: number;
        variantId: number;
        name: string;
        sku: string;
        quantity: number;
        price: string;
      }>;
      createdAt: string;
    }
  | { success: false; error: string };

export type GetOrderCoreInput = {
  orderId: string;
};

export type GetOrderInput = StepInput &
  GetOrderCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: GetOrderCoreInput,
  credentials: TiendanubeCredentials
): Promise<GetOrderResult> {
  const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
  const storeId = credentials.TIENDANUBE_STORE_ID;
  if (!(accessToken && storeId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const orderId = input.orderId?.toString().trim();
  if (!orderId) {
    return { success: false, error: "Order ID is required" };
  }

  try {
    const response = await fetch(
      storeUrl(storeId, `/orders/${encodeURIComponent(orderId)}`),
      { headers: authHeaders(accessToken) }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to get order"),
      };
    }

    const order = (await response.json()) as TiendanubeOrder;
    return {
      success: true,
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.payment_status,
      shippingStatus: order.shipping_status,
      total: order.total,
      currency: order.currency,
      customerEmail: order.contact_email ?? "",
      customerName: order.contact_name ?? "",
      customerPhone: order.contact_phone ?? "",
      products: (order.products ?? []).map((product) => ({
        productId: product.product_id,
        variantId: product.variant_id,
        name: product.name,
        sku: product.sku ?? "",
        quantity: product.quantity,
        price: product.price,
      })),
      createdAt: order.created_at ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get order: ${message}` };
  }
}

export async function getOrderStep(input: GetOrderInput): Promise<GetOrderResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
getOrderStep.maxRetries = 0;

export const _integrationType = "tiendanube";
