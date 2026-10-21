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

type TiendanubeVariant = {
  id: number;
  sku?: string | null;
  price?: string | null;
  stock?: number | null;
};

type TiendanubeProduct = {
  id: number;
  name?: string | Record<string, string>;
  variants?: TiendanubeVariant[];
};

type ListProductsResult =
  | {
      success: true;
      count: number;
      products: Array<{
        id: number;
        name: string;
        totalStock: number | null;
        variants: Array<{ id: number; sku: string; price: string; stock: number | null }>;
      }>;
    }
  | { success: false; error: string };

export type ListProductsCoreInput = {
  query?: string;
  limit?: string;
};

export type ListProductsInput = StepInput &
  ListProductsCoreInput & {
    integrationId?: string;
  };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function productName(name: TiendanubeProduct["name"]): string {
  if (!name) return "";
  if (typeof name === "string") return name;
  return name.es ?? Object.values(name)[0] ?? "";
}

async function stepHandler(
  input: ListProductsCoreInput,
  credentials: TiendanubeCredentials
): Promise<ListProductsResult> {
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
  const requestedLimit = Number(input.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
  params.set("per_page", String(limit));

  try {
    const response = await fetch(
      storeUrl(storeId, `/products?${params.toString()}`),
      { headers: authHeaders(accessToken) }
    );

    if (response.status === 404) {
      return { success: true, count: 0, products: [] };
    }
    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to list products"),
      };
    }

    const data = (await response.json()) as TiendanubeProduct[];
    const products = data.map((product) => {
      const variants = (product.variants ?? []).map((v) => ({
        id: v.id,
        sku: v.sku ?? "",
        price: v.price ?? "",
        stock: v.stock ?? null,
      }));
      const stocks = variants.map((v) => v.stock).filter((s): s is number => s !== null);
      const totalStock = stocks.length ? stocks.reduce((a, b) => a + b, 0) : null;
      return { id: product.id, name: productName(product.name), totalStock, variants };
    });
    return { success: true, count: products.length, products };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to list products: ${message}` };
  }
}

export async function listProductsStep(
  input: ListProductsInput
): Promise<ListProductsResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
listProductsStep.maxRetries = 0;

export const _integrationType = "tiendanube";
