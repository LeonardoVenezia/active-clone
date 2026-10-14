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

type TiendanubeOrderSummary = {
  id: number;
  number: number;
  status: string;
  payment_status: string;
  shipping_status: string;
  total: string;
  currency: string;
  contact_email?: string | null;
  contact_name?: string | null;
  created_at?: string;
};

type SearchOrdersResult =
  | {
      success: true;
      count: number;
      orders: Array<{
        id: number;
        number: number;
        status: string;
        paymentStatus: string;
        shippingStatus: string;
        total: string;
        currency: string;
        customerEmail: string;
        customerName: string;
        createdAt: string;
      }>;
    }
  | { success: false; error: string };

export type SearchOrdersCoreInput = {
  query?: string;
  status?: string;
  paymentStatus?: string;
  shippingStatus?: string;
  createdAtMin?: string;
  limit?: string;
};

export type SearchOrdersInput = StepInput &
  SearchOrdersCoreInput & {
    integrationId?: string;
  };

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

async function stepHandler(
  input: SearchOrdersCoreInput,
  credentials: TiendanubeCredentials
): Promise<SearchOrdersResult> {
  const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
  const storeId = credentials.TIENDANUBE_STORE_ID;
  if (!(accessToken && storeId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const params = new URLSearchParams();
  const query = input.query?.toString().trim();
  if (query) {
    params.set("q", query);
  }
  for (const [param, value] of [
    ["status", input.status],
    ["payment_status", input.paymentStatus],
    ["shipping_status", input.shippingStatus],
  ] as const) {
    const trimmed = value?.toString().trim();
    if (trimmed && trimmed !== "any") {
      params.set(param, trimmed);
    }
  }
  const createdAtMin = input.createdAtMin?.toString().trim();
  if (createdAtMin) {
    params.set("created_at_min", createdAtMin);
  }
  const requestedLimit = Number(input.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
  params.set("per_page", String(limit));

  try {
    const response = await fetch(
      storeUrl(storeId, `/orders?${params.toString()}`),
      { headers: authHeaders(accessToken) }
    );

    // Tiendanube answers 404 when a search has no results.
    if (response.status === 404) {
      return { success: true, count: 0, orders: [] };
    }
    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to search orders"),
      };
    }

    const data = (await response.json()) as TiendanubeOrderSummary[];
    const orders = data.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.payment_status,
      shippingStatus: order.shipping_status,
      total: order.total,
      currency: order.currency,
      customerEmail: order.contact_email ?? "",
      customerName: order.contact_name ?? "",
      createdAt: order.created_at ?? "",
    }));
    return { success: true, count: orders.length, orders };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to search orders: ${message}` };
  }
}

export async function searchOrdersStep(
  input: SearchOrdersInput
): Promise<SearchOrdersResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
searchOrdersStep.maxRetries = 0;

export const _integrationType = "tiendanube";
