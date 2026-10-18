import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasZipnovaCredentials, NOT_CONFIGURED_ERROR, zipnovaRequest } from "../api";
import type { ZipnovaCredentials } from "../credentials";

type Result =
  | { success: true; shipmentId: number | null; status: string | null; raw: unknown }
  | { success: false; error: string };
type Input = StepInput & {
  externalId: string;
  serviceType: string;
  declaredValue: string;
  recipientName: string;
  recipientDocument: string;
  recipientEmail: string;
  recipientPhone: string;
  weightGrams: string;
  originId?: string;
  logisticType?: string;
  carrierId?: string;
  sortBy?: string;
  processImmediately?: string;
  pointId?: string;
  street?: string;
  streetNumber?: string;
  streetExtras?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  packageHeightCm?: string;
  packageWidthCm?: string;
  packageLengthCm?: string;
  packageDescription?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: ZipnovaCredentials): Promise<Result> {
  if (!hasZipnovaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const required = [input.externalId, input.serviceType, input.declaredValue, input.recipientName,
    input.recipientDocument, input.recipientEmail, input.recipientPhone, input.weightGrams];
  if (required.some((v) => !v) || !Number.isFinite(Number(input.weightGrams)) || !Number.isFinite(Number(input.declaredValue))) {
    return { success: false, error: "externalId, serviceType, declaredValue, recipient data and weightGrams are required" };
  }
  const destination: Record<string, unknown> = {
    name: input.recipientName,
    document: input.recipientDocument,
    email: input.recipientEmail,
    phone: input.recipientPhone,
  };
  if (input.pointId) destination.point_id = input.pointId;
  if (input.street) destination.street = input.street;
  if (input.streetNumber) destination.street_number = input.streetNumber;
  if (input.streetExtras) destination.street_extras = input.streetExtras;
  if (input.city) destination.city = input.city;
  if (input.state) destination.state = input.state;
  if (input.zipcode) destination.zipcode = input.zipcode;

  const body: Record<string, unknown> = {
    account_id: Number(credentials.ZIPNOVA_ACCOUNT_ID),
    external_id: input.externalId,
    service_type: input.serviceType,
    logistic_type: input.logisticType || "ship_drop",
    origin_id: input.originId || "auto",
    declared_value: Number(input.declaredValue),
    source: "active-clone",
    process_immediately: input.processImmediately === "1" ? 1 : 0,
    destination,
    packages: [
      {
        weight: Number(input.weightGrams),
        height: Number(input.packageHeightCm || "10"),
        width: Number(input.packageWidthCm || "10"),
        length: Number(input.packageLengthCm || "10"),
        description_1: input.packageDescription || "Paquete",
      },
    ],
  };
  if (input.carrierId) body.carrier_id = Number(input.carrierId);
  if (input.sortBy) body.sort_by = input.sortBy;

  try {
    const result = (await zipnovaRequest(credentials, "POST", "/shipments", body)) as { id?: number; status?: string };
    return { success: true, shipmentId: result.id ?? null, status: result.status ?? null, raw: result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createShipmentStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
createShipmentStep.maxRetries = 0;

export const _integrationType = "zipnova";
