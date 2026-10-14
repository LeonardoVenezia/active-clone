import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { correoRequest, hasCorreoCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { CorreoArgentinoCredentials } from "../credentials";

type Rate = { deliveredType: string; productType: string; productName: string; price: number };
type Result =
  | { success: true; validTo: string; rates: Rate[]; cheapestPrice: number | null }
  | { success: false; error: string };
type Input = StepInput & {
  postalCodeOrigin: string;
  postalCodeDestination: string;
  weightGrams: string;
  heightCm: string;
  widthCm: string;
  lengthCm: string;
  deliveredType?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: CorreoArgentinoCredentials): Promise<Result> {
  if (!hasCorreoCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const num = (value: unknown) => Math.round(Number(value));
  const dimensions = {
    weight: num(input.weightGrams),
    height: num(input.heightCm),
    width: num(input.widthCm),
    length: num(input.lengthCm),
  };
  if (!input.postalCodeOrigin || !input.postalCodeDestination || Object.values(dimensions).some((v) => !Number.isFinite(v) || v <= 0)) {
    return { success: false, error: "Origin and destination postal codes, weight (g) and height/width/length (cm) are required" };
  }
  const deliveredType = input.deliveredType?.toString().trim().toUpperCase();
  try {
    const data = (await correoRequest(credentials, "POST", "/rates", {
      body: {
        customerId: credentials.CORREO_ARGENTINO_CUSTOMER_ID,
        postalCodeOrigin: input.postalCodeOrigin.toString().trim(),
        postalCodeDestination: input.postalCodeDestination.toString().trim(),
        ...(deliveredType === "D" || deliveredType === "S" ? { deliveredType } : {}),
        dimensions,
      },
    })) as { validTo?: string; rates?: Rate[] };
    const rates = data.rates ?? [];
    return {
      success: true,
      validTo: data.validTo ?? "",
      rates,
      cheapestPrice: rates.length ? Math.min(...rates.map((r) => r.price)) : null,
    };
  } catch (error) {
    return { success: false, error: `Failed to get rates: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function getRatesStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getRatesStep.maxRetries = 0;

export const _integrationType = "correoargentino";
