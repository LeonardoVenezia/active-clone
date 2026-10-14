import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { ArcaCredentials } from "../credentials";
import { createEngine, hasArcaCredentials } from "../engine";

const NOT_CONFIGURED_ERROR =
  "ARCA CUIT, certificate or private key is not configured. Please add them in Project Integrations.";

type Result =
  | { success: true; found: boolean; taxId: string; name: string; personType: string; condition: string; address: string; taxpayer: Record<string, unknown> | null }
  | { success: false; error: string };

type Input = StepInput & { taxId: string; integrationId?: string };

async function stepHandler(input: Input, credentials: ArcaCredentials): Promise<Result> {
  if (!hasArcaCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const taxId = input.taxId?.toString().replace(/\D/g, "");
  if (!taxId || taxId.length !== 11) {
    return { success: false, error: "Tax ID must be an 11-digit CUIT/CUIL" };
  }
  try {
    const engine = createEngine(credentials);
    const taxpayer = await engine.padron.getTaxpayerDetails(taxId);
    if (!taxpayer) {
      return { success: true, found: false, taxId, name: "", personType: "", condition: "", address: "", taxpayer: null };
    }
    const address = taxpayer.address as Record<string, unknown> | undefined;
    return {
      success: true,
      found: true,
      taxId: taxpayer.taxId,
      name: taxpayer.name ?? "",
      personType: taxpayer.personType ?? "",
      // Receiver condition to use when invoicing this taxpayer (see Issue Invoice).
      condition: taxpayer.condition !== undefined ? String(taxpayer.condition) : "",
      address: address ? Object.values(address).filter(Boolean).join(", ") : "",
      taxpayer: JSON.parse(JSON.stringify({ ...taxpayer, raw: undefined })) as Record<string, unknown>,
    };
  } catch (error) {
    return { success: false, error: `ARCA taxpayer lookup failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function lookupTaxpayerStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
lookupTaxpayerStep.maxRetries = 0;

export const _integrationType = "arca";
