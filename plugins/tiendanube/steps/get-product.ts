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

type TiendanubeProduct = {
  id: number;
  name: Record<string, string>;
  description?: Record<string, string> | null;
  published?: boolean;
  variants?: Array<{
    id: number;
    sku?: string | null;
    price?: string | null;
    stock?: number | null;
    stock_management?: boolean;
  }>;
};

type GetProductResult =
  | {
      success: true;
      id: number;
      name: string;
      description: string;
      published: boolean;
      variants: Array<{
        id: number;
        sku: string;
        price: string;
        stock: number | null;
      }>;
    }
  | { success: false; error: string };

export type GetProductCoreInput = {
  productId?: string;
  sku?: string;
};

export type GetProductInput = StepInput &
  GetProductCoreInput & {
    integrationId?: string;
  };

function firstName(name: Record<string, string> | undefined): string {
  if (!name) {
    return "";
  }
  return name.es ?? name.pt ?? name.en ?? Object.values(name)[0] ?? "";
}

/** Tiendanube sends the description as localized HTML; steps and AI prompts need plain text. */
export function descriptionText(description: Record<string, string> | null | undefined): string {
  const html = firstName(description ?? undefined);
  return html
    .replace(/<\s*br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()
    .slice(0, 4000);
}

async function stepHandler(
  input: GetProductCoreInput,
  credentials: TiendanubeCredentials
): Promise<GetProductResult> {
  const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
  const storeId = credentials.TIENDANUBE_STORE_ID;
  if (!(accessToken && storeId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const productId = input.productId?.toString().trim();
  const sku = input.sku?.toString().trim();
  if (!(productId || sku)) {
    return { success: false, error: "Either Product ID or SKU is required" };
  }

  const path = productId
    ? `/products/${encodeURIComponent(productId)}`
    : `/products/sku/${encodeURIComponent(sku as string)}`;

  try {
    const response = await fetch(storeUrl(storeId, path), {
      headers: authHeaders(accessToken),
    });

    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to get product"),
      };
    }

    const product = (await response.json()) as TiendanubeProduct;
    return {
      success: true,
      id: product.id,
      name: firstName(product.name),
      description: descriptionText(product.description),
      published: product.published ?? false,
      variants: (product.variants ?? []).map((variant) => ({
        id: variant.id,
        sku: variant.sku ?? "",
        price: variant.price ?? "",
        stock: variant.stock ?? null,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get product: ${message}` };
  }
}

export async function getProductStep(
  input: GetProductInput
): Promise<GetProductResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
getProductStep.maxRetries = 0;

export const _integrationType = "tiendanube";
