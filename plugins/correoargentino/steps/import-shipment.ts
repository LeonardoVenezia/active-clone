import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { correoRequest, hasCorreoCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { CorreoArgentinoCredentials } from "../credentials";

// POST /shipping/import is the only write endpoint in the official MiCorreo API.
type Result = { success: true; extOrderId: string; raw: unknown } | { success: false; error: string };
type Input = StepInput & {
  extOrderId: string;
  orderNumber: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone?: string;
  recipientCellPhone?: string;
  deliveryType: string;
  agency?: string;
  streetName?: string;
  streetNumber?: string;
  floor?: string;
  apartment?: string;
  city?: string;
  provinceCode?: string;
  postalCode?: string;
  weightGrams: string;
  declaredValue?: string;
  heightCm?: string;
  lengthCm?: string;
  widthCm?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: CorreoArgentinoCredentials): Promise<Result> {
  if (!hasCorreoCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.extOrderId || !input.orderNumber || !input.recipientName || !input.recipientEmail ||
      !input.deliveryType || !input.weightGrams) {
    return { success: false, error: "extOrderId, orderNumber, recipient data, deliveryType and weightGrams are required" };
  }
  if (input.deliveryType === "S" && !input.agency) {
    return { success: false, error: "Branch delivery (S) requires the agency code" };
  }
  if (input.deliveryType === "D" &&
      (!input.streetName || !input.streetNumber || !input.city || !input.postalCode || !input.provinceCode)) {
    return { success: false, error: "Home delivery (D) requires street, number, city, postal code and province" };
  }
  const num = (v?: string) => (v ? Number(v) : 0);
  const shipping: Record<string, unknown> = {
    deliveryType: input.deliveryType,
    weight: Number(input.weightGrams),
    declaredValue: num(input.declaredValue),
    height: num(input.heightCm),
    length: num(input.lengthCm),
    width: num(input.widthCm),
  };
  if (input.deliveryType === "S") {
    shipping.agency = input.agency;
  } else {
    shipping.address = {
      streetName: input.streetName,
      streetNumber: input.streetNumber,
      floor: input.floor || "",
      apartment: input.apartment || "",
      city: input.city,
      provinceCode: input.provinceCode,
      postalCode: input.postalCode,
    };
  }
  const body = {
    customerId: credentials.CORREO_ARGENTINO_CUSTOMER_ID,
    extOrderId: input.extOrderId,
    orderNumber: input.orderNumber,
    recipient: {
      name: input.recipientName,
      email: input.recipientEmail,
      phone: input.recipientPhone || "",
      cellPhone: input.recipientCellPhone || "",
    },
    shipping,
  };
  try {
    const result = await correoRequest(credentials, "POST", "/shipping/import", { body });
    return { success: true, extOrderId: input.extOrderId, raw: result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function importShipmentStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
importShipmentStep.maxRetries = 0;

export const _integrationType = "correoargentino";
