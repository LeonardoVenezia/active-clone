import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { StripeCredentials } from "../credentials";

const STRIPE_API_URL = "https://api.stripe.com/v1";

type StripeCustomer = {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
};

type Result =
  | { success: true; customers: StripeCustomer[]; count: number }
  | { success: false; error: string };

export type SearchCustomersCoreInput = {
  email?: string;
  limit?: string;
};

export type SearchCustomersInput = StepInput &
  SearchCustomersCoreInput & { integrationId?: string };

async function stepHandler(
  input: SearchCustomersCoreInput,
  credentials: StripeCredentials
): Promise<Result> {
  const apiKey = credentials.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "STRIPE_SECRET_KEY is not configured. Please add it in Project Integrations.",
    };
  }
  try {
    const params = new URLSearchParams();
    if (input.email) {
      params.append("email", input.email);
    }
    params.append("limit", input.limit || "10");
    const response = await fetch(`${STRIPE_API_URL}/customers?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const errorData = (await response.json()) as { error?: { message?: string } };
      return {
        success: false,
        error: errorData.error?.message || `HTTP ${response.status}: Failed to search customers`,
      };
    }
    const data = (await response.json()) as { data: StripeCustomer[] };
    const customers = data.data.map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      created: c.created,
    }));
    return { success: true, customers, count: customers.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to search customers: ${message}` };
  }
}

export async function searchCustomersStep(
  input: SearchCustomersInput
): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
searchCustomersStep.maxRetries = 0;

export const _integrationType = "stripe";
