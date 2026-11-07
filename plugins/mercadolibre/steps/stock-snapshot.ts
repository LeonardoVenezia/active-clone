import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch, NOT_CONFIGURED_ERROR } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

// Read-only catalog snapshot for stock comparison reports.
// Contract verified against developers.mercadolibre.com.ar (2026-11-07):
// - GET /users/me resolves the seller id of the connected account.
// - GET /users/{id}/items/search?status&limit lists item ids (private resource).
// - GET /items?ids=...&attributes=... is a multiget capped at 20 ids per call.
// - SKU lives in the SELLER_SKU attribute, at item level and per variation.
// - With the seller's own token, available_quantity is exact (public
//   resources return referential buckets instead).
// Not implemented: search_type=scan for catalogs over 1000 items.

type StockSnapshotResult =
  | {
      success: true;
      sellerId: number;
      count: number;
      items: Array<{
        id: string;
        title: string;
        status: string;
        availableQuantity: number;
        sku: string | null;
        variations: Array<{
          id: number;
          availableQuantity: number;
          sku: string | null;
          combination: string;
        }>;
      }>;
    }
  | { success: false; error: string };

export type StockSnapshotCoreInput = {
  status?: string;
  limit?: string;
};

export type StockSnapshotInput = StepInput &
  StockSnapshotCoreInput & {
    integrationId?: string;
  };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MULTIGET_CHUNK = 20;

type MlAttribute = { id?: string; value_name?: string | null };
type MlVariation = {
  id?: number;
  available_quantity?: number;
  attributes?: MlAttribute[];
  attribute_combinations?: Array<{ name?: string; value_name?: string | null }>;
};
type MlItemBody = {
  id?: string;
  title?: string;
  status?: string;
  available_quantity?: number;
  attributes?: MlAttribute[];
  variations?: MlVariation[];
};

function skuOf(attributes: MlAttribute[] | undefined): string | null {
  const sku = attributes?.find((a) => a.id === "SELLER_SKU")?.value_name;
  return sku ?? null;
}

async function stepHandler(
  input: StockSnapshotCoreInput,
  credentials: MercadoLibreCredentials,
  integrationId?: string
): Promise<StockSnapshotResult> {
  if (
    !credentials.MERCADOLIBRE_REFRESH_TOKEN &&
    !credentials.MERCADOLIBRE_ACCESS_TOKEN
  ) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const requestedLimit = Number(input.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
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
    const ids = (search.results ?? []).slice(0, limit);
    if (!ids.length) {
      return { success: true, sellerId: me.id, count: 0, items: [] };
    }

    const fields =
      "id,title,status,available_quantity,attributes,variations";
    const bodies: MlItemBody[] = [];
    for (let i = 0; i < ids.length; i += MULTIGET_CHUNK) {
      const chunk = ids.slice(i, i + MULTIGET_CHUNK);
      const itemsRes = await mlFetch(
        integrationId,
        credentials,
        `/items?ids=${chunk.join(",")}&attributes=${fields}`
      );
      if (!itemsRes.ok) {
        return {
          success: false,
          error: `Failed to fetch items: ${itemsRes.error}`,
        };
      }
      const raw = itemsRes.data as Array<{ code: number; body?: MlItemBody }>;
      for (const entry of raw) {
        if (entry.code === 200 && entry.body) {
          bodies.push(entry.body);
        }
      }
    }

    const items = bodies.map((body) => ({
      id: body.id ?? "",
      title: body.title ?? "",
      status: body.status ?? "",
      availableQuantity: body.available_quantity ?? 0,
      sku: skuOf(body.attributes),
      variations: (body.variations ?? []).map((v) => ({
        id: v.id ?? 0,
        availableQuantity: v.available_quantity ?? 0,
        sku: skuOf(v.attributes),
        combination: (v.attribute_combinations ?? [])
          .map((c) => `${c.name ?? ""}: ${c.value_name ?? ""}`)
          .join(" / "),
      })),
    }));

    return { success: true, sellerId: me.id, count: items.length, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to snapshot stock: ${message}` };
  }
}

export async function stockSnapshotStep(
  input: StockSnapshotInput
): Promise<StockSnapshotResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () =>
    stepHandler(input, credentials, input.integrationId)
  );
}
stockSnapshotStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
