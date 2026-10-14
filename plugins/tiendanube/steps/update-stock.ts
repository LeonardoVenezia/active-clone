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

type UpdatedVariant = {
  id: number;
  sku?: string | null;
  stock?: number | null;
};

type UpdateStockResult =
  | {
      success: true;
      updated: Array<{ id: number; sku: string; stock: number | null }>;
    }
  | { success: false; error: string };

export type UpdateStockCoreInput = {
  productId: string;
  variantId?: string;
  mode: string; // "replace" | "variation"
  quantity: string;
};

export type UpdateStockInput = StepInput &
  UpdateStockCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: UpdateStockCoreInput,
  credentials: TiendanubeCredentials
): Promise<UpdateStockResult> {
  const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
  const storeId = credentials.TIENDANUBE_STORE_ID;
  if (!(accessToken && storeId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const productId = input.productId?.toString().trim();
  if (!productId) {
    return { success: false, error: "Product ID is required" };
  }
  const mode = input.mode === "variation" ? "variation" : "replace";
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity)) {
    return { success: false, error: "Quantity must be a whole number" };
  }
  if (mode === "replace" && quantity < 0) {
    return { success: false, error: "Stock to set cannot be negative" };
  }

  const body: Record<string, unknown> = { action: mode, value: quantity };
  const variantId = input.variantId?.toString().trim();
  if (variantId) {
    // Without an id the update applies to ALL variants of the product.
    body.id = Number(variantId);
  }

  try {
    const response = await fetch(
      storeUrl(
        storeId,
        `/products/${encodeURIComponent(productId)}/variants/stock`
      ),
      {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to update stock"),
      };
    }

    const variants = (await response.json()) as UpdatedVariant[];
    return {
      success: true,
      updated: variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku ?? "",
        stock: variant.stock ?? null,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to update stock: ${message}` };
  }
}

export async function updateStockStep(
  input: UpdateStockInput
): Promise<UpdateStockResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
updateStockStep.maxRetries = 0;

export const _integrationType = "tiendanube";
