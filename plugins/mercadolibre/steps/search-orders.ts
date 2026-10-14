import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; orders: Array<{ id: string; status: string; total: number; currency: string; buyerNickname: string; dateCreated: string }>; count: number; total: number }
  | { success: false; error: string };

export type SearchOrdersInput = StepInput & {
  query?: string;
  status?: string;
  limit?: string;
  integrationId?: string;
};

type MlSearch = {
  paging?: { total?: number };
  results?: Array<{ id: number; status: string; total_amount?: number; currency_id?: string; date_created?: string; buyer?: { nickname?: string } }>;
};

async function stepHandler(
  input: SearchOrdersInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const sellerId = credentials.MERCADOLIBRE_USER_ID;
  if (!sellerId) {
    return { success: false, error: "Mercado Libre user ID is missing from the connection" };
  }
  const params = new URLSearchParams({ seller: sellerId, sort: "date_desc" });
  if (input.status && input.status !== "any") {
    params.set("order.status", input.status);
  }
  if (input.query?.trim()) {
    params.set("q", input.query.trim());
  }
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  params.set("limit", String(limit));
  try {
    const result = await mlFetch(input.integrationId, credentials, `/orders/search?${params}`);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const body = result.data as MlSearch;
    const orders = (body.results ?? []).map((order) => ({
      id: String(order.id),
      status: order.status,
      total: order.total_amount ?? 0,
      currency: order.currency_id ?? "",
      buyerNickname: order.buyer?.nickname ?? "",
      dateCreated: order.date_created ?? "",
    }));
    return { success: true, orders, count: orders.length, total: body.paging?.total ?? orders.length };
  } catch (error) {
    return { success: false, error: `Failed to search orders: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function searchOrdersStep(input: SearchOrdersInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
searchOrdersStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
