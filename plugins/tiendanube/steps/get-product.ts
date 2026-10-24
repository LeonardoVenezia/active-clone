import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import {
  authHeaders,
  NOT_CONFIGURED_ERROR,
  readTiendanubeError,
  storeUrl,
} from "../api";
import { tiendanubeDescription } from "@/lib/text/description";
import type { TiendanubeCredentials } from "../credentials";

type TiendanubeProduct = {
  id: number;
  name: Record<string, string>;
  description?: unknown;
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
      descriptionTruncated: boolean;
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
    const desc = tiendanubeDescription(product.description);
    return {
      success: true,
      id: product.id,
      name: firstName(product.name),
      description: desc.text,
      descriptionTruncated: desc.truncated,
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
