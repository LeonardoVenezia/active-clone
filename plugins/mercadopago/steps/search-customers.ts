import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { MercadoPagoCredentials } from "../credentials";
import {
  MERCADOPAGO_API_URL,
  NOT_CONFIGURED_ERROR,
  readMercadoPagoError,
} from "./shared";

type CustomerSummary = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dateCreated: string;
};

type SearchCustomersResult =
  | { success: true; customers: CustomerSummary[]; count: number }
  | { success: false; error: string };

export type SearchCustomersCoreInput = {
  email?: string;
};

export type SearchCustomersInput = StepInput &
  SearchCustomersCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: SearchCustomersCoreInput,
  credentials: MercadoPagoCredentials
): Promise<SearchCustomersResult> {
  const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const params = new URLSearchParams();
  if (input.email?.toString().trim()) {
    params.set("email", input.email.toString().trim());
  }

  try {
    const response = await fetch(
      `${MERCADOPAGO_API_URL}/v1/customers/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readMercadoPagoError(response, "Failed to search customers"),
      };
    }

    const data = (await response.json()) as {
      results?: Array<{
        id?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
        date_created?: string;
      }>;
    };
    const customers = (data.results ?? []).map((c) => ({
      id: c.id ?? "",
      email: c.email ?? "",
      firstName: c.first_name ?? "",
      lastName: c.last_name ?? "",
      dateCreated: c.date_created ?? "",
    }));
    return { success: true, customers, count: customers.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to search customers: ${message}` };
  }
}

export async function searchCustomersStep(
  input: SearchCustomersInput
): Promise<SearchCustomersResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
searchCustomersStep.maxRetries = 0;

export const _integrationType = "mercadopago";
