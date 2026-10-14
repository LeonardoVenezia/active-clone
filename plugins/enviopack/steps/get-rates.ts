import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { enviopackGet, hasEnviopackCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { EnviopackCredentials } from "../credentials";

type Rate = {
  correo?: { id?: string; nombre?: string };
  despacho?: string;
  modalidad?: string;
  servicio?: string;
  valor?: string;
  horas_entrega?: number;
};
type Result =
  | { success: true; count: number; rates: Rate[]; cheapest: Rate | null }
  | { success: false; error: string };
type Input = StepInput & {
  provinceId: string;
  postalCode: string;
  weightKg: string;
  packages?: string;
  carrierId?: string;
  deliveryMode?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: EnviopackCredentials): Promise<Result> {
  if (!hasEnviopackCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const provinceId = input.provinceId?.toString().trim().toUpperCase();
  const postalCode = input.postalCode?.toString().trim();
  const weightKg = input.weightKg?.toString().trim();
  if (!provinceId || !postalCode || !weightKg) {
    return { success: false, error: "Province ID, 4-digit postal code and weight (kg) are required" };
  }
  try {
    const data = await enviopackGet(credentials, "/cotizar/costo", {
      provincia: provinceId,
      codigo_postal: postalCode,
      peso: weightKg,
      paquetes: input.packages?.toString().trim(),
      correo: input.carrierId?.toString().trim().toLowerCase(),
      modalidad: input.deliveryMode?.toString().trim().toUpperCase(),
    });
    const rates = Array.isArray(data) ? (data as Rate[]) : [];
    const sorted = [...rates].sort((a, b) => Number(a.valor ?? Infinity) - Number(b.valor ?? Infinity));
    return { success: true, count: rates.length, rates, cheapest: sorted[0] ?? null };
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

export const _integrationType = "enviopack";
