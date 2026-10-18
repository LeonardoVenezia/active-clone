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

type CustomerSummary = {
  id: number;
  name: string;
  email: string;
  phone: string;
  identification: string;
  createdAt: string;
};

type SearchCustomersResult =
  | { success: true; customers: CustomerSummary[]; count: number }
  | { success: false; error: string };

export type SearchCustomersCoreInput = {
  email?: string;
  query?: string;
  limit?: string;
};

export type SearchCustomersInput = StepInput &
  SearchCustomersCoreInput & {
    integrationId?: string;
  };

type TiendanubeCustomer = {
  id: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  identification?: string | null;
  created_at?: string;
};

async function stepHandler(
  input: SearchCustomersCoreInput,
  credentials: TiendanubeCredentials
): Promise<SearchCustomersResult> {
  const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
  const storeId = credentials.TIENDANUBE_STORE_ID;
  if (!(accessToken && storeId)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const params = new URLSearchParams();
  const email = input.email?.toString().trim();
  const query = input.query?.toString().trim();
  const limit = input.limit?.toString().trim();
  if (email) {
    params.set("email", email);
  }
  if (query) {
    params.set("q", query);
  }
  params.set("per_page", limit && Number(limit) > 0 ? String(Math.min(Number(limit), 200)) : "30");

  try {
    const response = await fetch(storeUrl(storeId, `/customers?${params.toString()}`), {
      headers: authHeaders(accessToken),
    });

    if (!response.ok) {
      return {
        success: false,
        error: await readTiendanubeError(response, "Failed to search customers"),
      };
    }

    const data = (await response.json()) as TiendanubeCustomer[];
    const customers = (Array.isArray(data) ? data : []).map((c) => ({
      id: c.id,
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      identification: c.identification ?? "",
      createdAt: c.created_at ?? "",
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

export const _integrationType = "tiendanube";
