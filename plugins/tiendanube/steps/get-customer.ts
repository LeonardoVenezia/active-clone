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

type GetCustomerResult =
  | {
      success: true;
      id: number;
      name: string;
      email: string;
      phone: string;
      identification: string;
      totalSpent: string;
      ordersCount: number;
      createdAt: string;
    }
  | { success: false; error: string };

export type GetCustomerCoreInput = {
  customerId: string;
};

export type GetCustomerInput = StepInput &
  GetCustomerCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: GetCustomerCoreInput,
  credentials: TiendanubeCredentials
): Promise<GetCustomerResult> {
  const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
  const storeId = credentials.TIENDANUBE_STORE_ID;
  if (!(accessToken && storeId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const customerId = input.customerId?.toString().trim();
  if (!customerId) {
    return { success: false, error: "Customer ID is required" };
  }

  try {
    const response = await fetch(
      storeUrl(storeId, `/customers/${encodeURIComponent(customerId)}`),
      { headers: authHeaders(accessToken) }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to get customer"),
      };
    }

    const c = (await response.json()) as {
      id: number;
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      identification?: string | null;
      total_spent?: string | null;
      last_order_id?: number | null;
      created_at?: string;
    };
    return {
      success: true,
      id: c.id,
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      identification: c.identification ?? "",
      totalSpent: c.total_spent ?? "",
      ordersCount: 0,
      createdAt: c.created_at ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get customer: ${message}` };
  }
}

export async function getCustomerStep(
  input: GetCustomerInput
): Promise<GetCustomerResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getCustomerStep.maxRetries = 0;

export const _integrationType = "tiendanube";
