import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch, NOT_CONFIGURED_ERROR } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type ListItemsResult =
  | {
      success: true;
      count: number;
      items: Array<{
        id: string;
        title: string;
        availableQuantity: number;
        price: number;
        status: string;
      }>;
    }
  | { success: false; error: string };

export type ListItemsCoreInput = {
  query?: string;
  status?: string;
  limit?: string;
};

export type ListItemsInput = StepInput &
  ListItemsCoreInput & {
    integrationId?: string;
  };

const DEFAULT_LIMIT = 50;

type MlItem = {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
};

async function stepHandler(
  input: ListItemsCoreInput,
  credentials: MercadoLibreCredentials,
  integrationId?: string
): Promise<ListItemsResult> {
  if (!credentials.MERCADOLIBRE_REFRESH_TOKEN && !credentials.MERCADOLIBRE_ACCESS_TOKEN) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const requestedLimit = Number(input.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), 100)
      : DEFAULT_LIMIT;

  try {
    const meRes = await mlFetch(integrationId, credentials, "/users/me");
    if (!meRes.ok) {
      return { success: false, error: `Failed to resolve seller: ${meRes.error}` };
    }
    const me = meRes.data as { id?: number };
    if (!me.id) {
      return { success: false, error: "Failed to resolve seller id" };
    }

    const params = new URLSearchParams({ limit: String(limit) });
    const query = input.query?.toString().trim();
    if (query) params.set("q", query);
    const status = input.status?.toString().trim();
    if (status && status !== "any") params.set("status", status);

    const searchRes = await mlFetch(
      integrationId,
      credentials,
      `/users/${me.id}/items/search?${params.toString()}`
    );
    if (!searchRes.ok) {
      return { success: false, error: `Failed to list items: ${searchRes.error}` };
    }
    const search = searchRes.data as { results?: string[] };
    const ids = search.results ?? [];
    if (!ids.length) {
      return { success: true, count: 0, items: [] };
    }

    const itemsRes = await mlFetch(
      integrationId,
      credentials,
      `/items?ids=${ids.join(",")}`
    );
    if (!itemsRes.ok) {
      return { success: false, error: `Failed to fetch items: ${itemsRes.error}` };
    }
    const raw = itemsRes.data as Array<{ code: number; body?: MlItem }>;
    const items = raw
      .filter((r) => r.code === 200 && r.body)
      .map((r) => ({
        id: r.body!.id,
        title: r.body!.title,
        availableQuantity: r.body!.available_quantity,
        price: r.body!.price,
        status: r.body!.status,
      }));
    return { success: true, count: items.length, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to list items: ${message}` };
  }
}

export async function listItemsStep(
  input: ListItemsInput
): Promise<ListItemsResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () =>
    stepHandler(input, credentials, input.integrationId)
  );
}
listItemsStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
