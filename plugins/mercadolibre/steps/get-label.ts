import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | { success: true; shipmentId: string; format: string; zpl: string }
  | { success: false; error: string };

export type GetLabelInput = StepInput & {
  shipmentId: string;
  integrationId?: string;
};

async function stepHandler(
  input: GetLabelInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const shipmentId = input.shipmentId?.toString().trim();
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  try {
    // ZPL is plain text for thermal printers; mlFetch returns non-JSON as text.
    const result = await mlFetch(
      input.integrationId,
      credentials,
      `/shipment_labels?shipment_ids=${encodeURIComponent(shipmentId)}&response_type=zpl2`
    );
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const zpl = typeof result.data === "string" ? result.data : "";
    if (!zpl) {
      return {
        success: false,
        error:
          "Mercado Libre returned an empty label. The shipment may not be ready to print yet.",
      };
    }
    return { success: true, shipmentId, format: "zpl2", zpl };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get label: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function getShipmentLabelStep(input: GetLabelInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getShipmentLabelStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
