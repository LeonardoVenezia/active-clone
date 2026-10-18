import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasXubioCredentials, NOT_CONFIGURED_ERROR, xubioPost } from "../api";
import type { XubioCredentials } from "../credentials";

type Result =
  | { success: true; customerId: string; name: string }
  | { success: false; error: string };

type Input = StepInput & {
  name?: string;
  taxIdType?: string;
  cuit?: string;
  fiscalCategory?: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  integrationId?: string;
};

const FISCAL_CATEGORIES = ["RI", "MT", "CF", "EX", "NA", "CE"];

async function stepHandler(input: Input, credentials: XubioCredentials): Promise<Result> {
  if (!hasXubioCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const name = input.name?.toString().trim();
  if (!name) {
    return { success: false, error: "Customer name is required" };
  }
  const taxIdType = (input.taxIdType?.toString().trim().toUpperCase() || "CUIT");
  const fiscalCategory = (input.fiscalCategory?.toString().trim().toUpperCase() || "CF");
  if (!FISCAL_CATEGORIES.includes(fiscalCategory)) {
    return { success: false, error: `Fiscal category must be one of: ${FISCAL_CATEGORIES.join(", ")}` };
  }
  const body: Record<string, unknown> = {
    nombre: name,
    identificacionTributaria: { codigo: taxIdType },
    categoriaFiscal: { codigo: fiscalCategory },
  };
  const cuit = input.cuit?.toString().trim();
  if (cuit) {
    body.CUIT = cuit;
  }
  const email = input.email?.toString().trim();
  if (email) {
    body.email = email;
  }
  const phone = input.phone?.toString().trim();
  if (phone) {
    body.telefono = phone;
  }
  const address = input.address?.toString().trim();
  if (address) {
    body.direccion = address;
  }
  const postalCode = input.postalCode?.toString().trim();
  if (postalCode) {
    body.codigoPostal = postalCode;
  }
  try {
    const data = (await xubioPost(credentials, "clienteBean", body)) as { cliente_id?: number | string };
    return { success: true, customerId: String(data.cliente_id ?? ""), name };
  } catch (error) {
    return { success: false, error: `Failed to create customer: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function createCustomerStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
createCustomerStep.maxRetries = 0;

export const _integrationType = "xubio";
