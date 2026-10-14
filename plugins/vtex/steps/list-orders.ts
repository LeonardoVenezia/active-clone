import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasVtexCredentials, NOT_CONFIGURED_ERROR, readVtexError, vtexBaseUrl, vtexHeaders } from "../api";
import type { VtexCredentials } from "../credentials";

type Result =
  | { success: true; orders: Array<{ orderId: string; status: string; statusDescription: string; totalValue: number; creationDate: string; clientName: string }>; count: number; total: number }
  | { success: false; error: string };

type Input = StepInput & { query?: string; status?: string; perPage?: string; integrationId?: string };

type VtexList = {
  list?: Array<{ orderId: string; status: string; statusDescription?: string; totalValue: number; creationDate?: string; clientName?: string }>;
  paging?: { total?: number };
};

async function stepHandler(input: Input, credentials: VtexCredentials): Promise<Result> {
  if (!hasVtexCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const params = new URLSearchParams({ orderBy: "creationDate,desc", page: "1" });
  params.set("per_page", String(Math.min(Math.max(Number(input.perPage) || 15, 1), 100)));
  if (input.query?.trim()) {
    params.set("q", input.query.trim());
  }
  if (input.status && input.status !== "any") {
    params.set("f_status", input.status);
  }
  try {
    const response = await fetch(`${vtexBaseUrl(credentials)}/api/oms/pvt/orders?${params}`, {
      headers: vtexHeaders(credentials),
    });
    if (!response.ok) {
      return { success: false, error: await readVtexError(response, "Failed to list orders") };
    }
    const body = (await response.json()) as VtexList;
    const orders = (body.list ?? []).map((order) => ({
      orderId: order.orderId,
      status: order.status,
      statusDescription: order.statusDescription ?? "",
      totalValue: order.totalValue,
      creationDate: order.creationDate ?? "",
      clientName: order.clientName ?? "",
    }));
    return { success: true, orders, count: orders.length, total: body.paging?.total ?? orders.length };
  } catch (error) {
    return { success: false, error: `Failed to list orders: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listOrdersStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listOrdersStep.maxRetries = 0;

export const _integrationType = "vtex";
