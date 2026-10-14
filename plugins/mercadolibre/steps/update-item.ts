import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; id: string; price: number; availableQuantity: number; status: string }
  | { success: false; error: string };

export type UpdateItemInput = StepInput & {
  itemId: string;
  price?: string;
  availableQuantity?: string;
  status?: string;
  integrationId?: string;
};

type MlItem = { id: string; price: number; available_quantity: number; status: string };

async function stepHandler(
  input: UpdateItemInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const itemId = input.itemId?.toString().trim();
  if (!itemId) {
    return { success: false, error: "Item ID is required (for example MLA123456789)" };
  }
  // Only send what the user filled in; empty fields leave the listing as is.
  const body: Record<string, unknown> = {};
  if (input.price?.toString().trim()) {
    const price = Number(input.price);
    if (!(price > 0)) {
      return { success: false, error: "Price must be a number greater than 0" };
    }
    body.price = price;
  }
  if (input.availableQuantity?.toString().trim()) {
    const quantity = Number(input.availableQuantity);
    if (!(Number.isInteger(quantity) && quantity >= 0)) {
      return { success: false, error: "Available quantity must be a whole number, 0 or more" };
    }
    body.available_quantity = quantity;
  }
  if (input.status && input.status !== "keep") {
    body.status = input.status;
  }
  if (Object.keys(body).length === 0) {
    return { success: false, error: "Fill at least one field to update" };
  }
  try {
    const result = await mlFetch(input.integrationId, credentials, `/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body,
    });
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const item = result.data as MlItem;
    return { success: true, id: item.id, price: item.price, availableQuantity: item.available_quantity, status: item.status };
  } catch (error) {
    return { success: false, error: `Failed to update item: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function updateItemStep(input: UpdateItemInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
updateItemStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
