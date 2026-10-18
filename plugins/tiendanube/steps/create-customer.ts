import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import {
  authHeaders,
  NOT_CONFIGURED_ERROR,
  readTiendanubeError,
  storeUrl,
} from "../api";
import type { TiendanubeCredentials } from "../credentials";

type CreateCustomerResult =
  | { success: true; id: number; name: string; email: string }
  | { success: false; error: string };

export type CreateCustomerCoreInput = {
  name: string;
  email: string;
  phone?: string;
  identification?: string;
  sendWelcomeEmail?: string;
};

export type CreateCustomerInput = StepInput &
  CreateCustomerCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: CreateCustomerCoreInput,
  credentials: TiendanubeCredentials
): Promise<CreateCustomerResult> {
  const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
  const storeId = credentials.TIENDANUBE_STORE_ID;
  if (!(accessToken && storeId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const name = input.name?.toString().trim();
  const email = input.email?.toString().trim();
  if (!name) {
    return { success: false, error: "Customer name is required" };
  }
  if (!email) {
    return { success: false, error: "Customer email is required" };
  }

  try {
    const response = await fetch(storeUrl(storeId, "/customers"), {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        name,
        email,
        ...(input.phone?.toString().trim()
          ? { phone: input.phone.toString().trim() }
          : {}),
        ...(input.identification?.toString().trim()
          ? { identification: input.identification.toString().trim() }
          : {}),
        send_email: input.sendWelcomeEmail === "1",
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to create customer"),
      };
    }

    const c = (await response.json()) as {
      id?: number;
      name?: string | null;
      email?: string | null;
    };
    return {
      success: true,
      id: c.id ?? 0,
      name: c.name ?? name,
      email: c.email ?? email,
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

export const _integrationType = "tiendanube";
