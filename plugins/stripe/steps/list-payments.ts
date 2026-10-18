import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { StripeCredentials } from "../credentials";

const STRIPE_API_URL = "https://api.stripe.com/v1";

type Payment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  customerId: string | null;
  created: number;
};

type Result =
  | { success: true; payments: Payment[]; count: number; hasMore: boolean }
  | { success: false; error: string };

export type ListPaymentsCoreInput = {
  customerId?: string;
  limit?: string;
};

export type ListPaymentsInput = StepInput &
  ListPaymentsCoreInput & { integrationId?: string };

async function stepHandler(
  input: ListPaymentsCoreInput,
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
    if (input.customerId) {
      params.append("customer", input.customerId);
    }
    params.append("limit", input.limit || "10");
    const response = await fetch(
      `${STRIPE_API_URL}/payment_intents?${params.toString()}`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!response.ok) {
      const errorData = (await response.json()) as { error?: { message?: string } };
      return {
        success: false,
        error: errorData.error?.message || `HTTP ${response.status}: Failed to list payments`,
      };
    }
    const data = (await response.json()) as {
      data: Array<{
        id: string;
        status: string;
        amount: number;
        currency: string;
        customer: string | null;
        created: number;
      }>;
      has_more: boolean;
    };
    const payments = data.data.map((pi) => ({
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      customerId: pi.customer,
      created: pi.created,
    }));
    return { success: true, payments, count: payments.length, hasMore: data.has_more };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to list payments: ${message}` };
  }
}

export async function listPaymentsStep(
  input: ListPaymentsInput
): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listPaymentsStep.maxRetries = 0;

export const _integrationType = "stripe";
