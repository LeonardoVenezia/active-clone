import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { MercadoPagoCredentials } from "../credentials";
import {
  MERCADOPAGO_API_URL,
  NOT_CONFIGURED_ERROR,
  readMercadoPagoError,
} from "./shared";

type CreateCustomerResult =
  | { success: true; id: string; email: string; firstName: string; lastName: string }
  | { success: false; error: string };

export type CreateCustomerCoreInput = {
  email: string;
  firstName?: string;
  lastName?: string;
};

export type CreateCustomerInput = StepInput &
  CreateCustomerCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: CreateCustomerCoreInput,
  credentials: MercadoPagoCredentials
): Promise<CreateCustomerResult> {
  const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const email = input.email?.toString().trim();
  if (!email) {
    return { success: false, error: "Customer email is required" };
  }

  try {
    const response = await fetch(`${MERCADOPAGO_API_URL}/v1/customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        ...(input.firstName ? { first_name: input.firstName } : {}),
        ...(input.lastName ? { last_name: input.lastName } : {}),
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: await readMercadoPagoError(response, "Failed to create customer"),
      };
    }

    const customer = (await response.json()) as {
      id?: string;
      email?: string;
      first_name?: string;
      last_name?: string;
    };
    return {
      success: true,
      id: customer.id ?? "",
      email: customer.email ?? email,
      firstName: customer.first_name ?? "",
      lastName: customer.last_name ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to create customer: ${message}` };
  }
}

export async function createCustomerStep(
  input: CreateCustomerInput
): Promise<CreateCustomerResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
createCustomerStep.maxRetries = 0;

export const _integrationType = "mercadopago";
