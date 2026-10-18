import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { mlFetch } from "../api";
import type { MercadoLibreCredentials } from "../credentials";

type Result =
  | {
      success: true;
      shipment: Record<string, unknown>;
      id: string;
      status: string;
      substatus: string;
      trackingNumber: string;
      trackingMethod: string;
      serviceId: string;
      estimatedDelivery: string;
      receiverCity: string;
    }
  | { success: false; error: string };

export type GetShipmentInput = StepInput & {
  shipmentId: string;
  integrationId?: string;
};

type MlShipment = {
  id?: number;
  status?: string;
  substatus?: string | null;
  tracking_number?: string;
  tracking_method?: string;
  service_id?: number;
  receiver_address?: { city?: { name?: string } };
  shipping_option?: { estimated_delivery?: { date?: string } };
  lead_time?: { estimated_delivery_time?: { date?: string } };
};

async function stepHandler(
  input: GetShipmentInput,
  credentials: MercadoLibreCredentials
): Promise<Result> {
  const shipmentId = input.shipmentId?.toString().trim();
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  try {
    const result = await mlFetch(
      input.integrationId,
      credentials,
      `/shipments/${encodeURIComponent(shipmentId)}`
    );
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const shipment = result.data as MlShipment;
    return {
      success: true,
      shipment: shipment as unknown as Record<string, unknown>,
      id: shipment.id ? String(shipment.id) : shipmentId,
      status: shipment.status ?? "",
      substatus: shipment.substatus ?? "",
      trackingNumber: shipment.tracking_number ?? "",
      trackingMethod: shipment.tracking_method ?? "",
      serviceId: shipment.service_id ? String(shipment.service_id) : "",
      estimatedDelivery:
        shipment.shipping_option?.estimated_delivery?.date ??
        shipment.lead_time?.estimated_delivery_time?.date ??
        "",
      receiverCity: shipment.receiver_address?.city?.name ?? "",
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get shipment: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function getShipmentStep(input: GetShipmentInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getShipmentStep.maxRetries = 0;

export const _integrationType = "mercadolibre";
