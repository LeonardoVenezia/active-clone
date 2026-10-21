import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasZipnovaCredentials, NOT_CONFIGURED_ERROR, zipnovaRequest } from "../api";
import type { ZipnovaCredentials } from "../credentials";

type ShipmentOutput = {
  id: string;
  status: string;
  statusDetail: string;
  tracking: string;
  carrier: string;
  estimatedDelivery: string;
  externalId: string;
};
type Result = { success: true } & ShipmentOutput & { shipment: unknown } | { success: false; error: string };
type Input = StepInput & { shipmentId: string; integrationId?: string };

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** La API anida el envío de forma variable; aplanar a campos estables. */
function mapShipment(raw: unknown): ShipmentOutput {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inner = obj.shipment && typeof obj.shipment === "object" ? (obj.shipment as Record<string, unknown>) : obj;
  const carrier = inner.carrier;
  return {
    id: str(inner.id),
    status: str(inner.status ?? inner.state),
    statusDetail: str(inner.status_detail ?? inner.statusDetail ?? inner.status_description ?? inner.statusDescription),
    tracking: str(inner.tracking_number ?? inner.trackingNumber ?? inner.tracking),
    carrier: str(carrier && typeof carrier === "object" ? (carrier as Record<string, unknown>).name : carrier),
    estimatedDelivery: str(inner.estimated_delivery ?? inner.estimatedDelivery ?? inner.delivery_estimate ?? inner.eta),
    externalId: str(inner.external_id ?? inner.externalId),
  };
}

async function stepHandler(input: Input, credentials: ZipnovaCredentials): Promise<Result> {
  if (!hasZipnovaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.shipmentId) return { success: false, error: "shipmentId is required" };
  try {
    const shipment = await zipnovaRequest(credentials, "GET", `/shipments/${input.shipmentId}`);
    return { success: true, ...mapShipment(shipment), shipment };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function zipnovaGetShipment(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
zipnovaGetShipment.maxRetries = 0;

export const _integrationType = "zipnova";
