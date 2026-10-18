import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { StripeCredentials } from "../credentials";

const STRIPE_API_URL = "https://api.stripe.com/v1";

type Result =
  | {
      success: true;
      id: string;
      status: string;
      amount: number;
      currency: string;
      customerId: string | null;
      receiptEmail: string | null;
      created: number;
    }
  | { success: false; error: string };

export type GetPaymentCoreInput = { paymentIntentId?: string };

export type GetPaymentInput = StepInput &
  GetPaymentCoreInput & { integrationId?: string };

async function stepHandler(
  input: GetPaymentCoreInput,
  credentials: StripeCredentials
): Promise<Result> {
  const apiKey = credentials.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "STRIPE_SECRET_KEY is not configured. Please add it in Project Integrations.",
    };
  }
  if (!input.paymentIntentId) {
    return { success: false, error: "Payment Intent ID is required (pi_...)" };
  }
  try {
    const response = await fetch(
      `${STRIPE_API_URL}/payment_intents/${encodeURIComponent(input.paymentIntentId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!response.ok) {
      const errorData = (await response.json()) as { error?: { message?: string } };
      return {
        success: false,
        error: errorData.error?.message || `HTTP ${response.status}: Failed to get payment`,
      };
    }
    const pi = (await response.json()) as {
      id: string;
      status: string;
      amount: number;
      currency: string;
      customer: string | null;
      receipt_email: string | null;
      created: number;
    };
    return {
      success: true,
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      customerId: pi.customer,
      receiptEmail: pi.receipt_email,
      created: pi.created,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get payment: ${message}` };
  }
}

export async function getPaymentStep(input: GetPaymentInput): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
getPaymentStep.maxRetries = 0;

export const _integrationType = "stripe";
