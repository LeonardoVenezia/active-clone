import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; id: string; title: string; description: string; price: number; currency: string; availableQuantity: number; soldQuantity: number; status: string; permalink: string }
  | { success: false; error: string };

export type GetItemInput = StepInput & { itemId: string; integrationId?: string };

type MlItem = {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  sold_quantity: number;
  status: string;
  permalink?: string;
};

export function plainDescription(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim().slice(0, 4000) : "";
}

async function stepHandler(
  input: GetItemInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const itemId = input.itemId?.toString().trim();
  if (!itemId) {
    return { success: false, error: "Item ID is required (for example MLA123456789)" };
  }
  try {
    const result = await mlFetch(input.integrationId, credentials, `/items/${encodeURIComponent(itemId)}`);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const item = result.data as MlItem;
    // The listing text lives in a separate endpoint; a listing without one answers 404, which is not an error for this step.
    const desc = await mlFetch(input.integrationId, credentials, `/items/${encodeURIComponent(itemId)}/description`).catch(() => null);
    const description = desc?.ok ? plainDescription((desc.data as { plain_text?: unknown })?.plain_text) : "";
    return {
      success: true,
      id: item.id,
      title: item.title,
      description,
      price: item.price,
      currency: item.currency_id,
      availableQuantity: item.available_quantity,
      soldQuantity: item.sold_quantity,
      status: item.status,
      permalink: item.permalink ?? "",
    };
  } catch (error) {
    return { success: false, error: `Failed to get item: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getItemStep(input: GetItemInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getItemStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
