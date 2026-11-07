// Pure mapping helpers for the Mercado Libre stock-snapshot step.
// Kept free of "server-only" and credential imports so node:test can run
// parser tests against documented payloads without a Next.js runtime.

export type MlAttribute = { id?: string; value_name?: string | null };
export type MlVariation = {
  id?: number;
  available_quantity?: number;
  attributes?: MlAttribute[];
  attribute_combinations?: Array<{ name?: string; value_name?: string | null }>;
};
export type MlItemBody = {
  id?: string;
  title?: string;
  status?: string;
  available_quantity?: number;
  attributes?: MlAttribute[];
  variations?: MlVariation[];
};

export type StockSnapshotItem = {
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
};

// SKU contract (developers.mercadolibre.com.ar, Items & Searches / Variations):
// the stock code is the SELLER_SKU attribute, at item level and per variation.
export function skuOf(attributes: MlAttribute[] | undefined): string | null {
  const sku = attributes?.find((a) => a.id === "SELLER_SKU")?.value_name;
  return sku ?? null;
}

export function mapItemBody(body: MlItemBody): StockSnapshotItem {
  return {
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
  };
}

// The /items multiget is capped at 20 ids per call by the API.
export function chunkIds(ids: string[], size = 20): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}
