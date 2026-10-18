import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { StripeCredentials } from "../credentials";

const STRIPE_API_URL = "https://api.stripe.com/v1";

type Result =
  | { success: true; id: string; url: string }
  | { success: false; error: string };

export type CreatePaymentLinkCoreInput = {
  priceId?: string;
  quantity?: string;
};

export type CreatePaymentLinkInput = StepInput &
  CreatePaymentLinkCoreInput & { integrationId?: string };

async function stepHandler(
  input: CreatePaymentLinkCoreInput,
  credentials: StripeCredentials
): Promise<Result> {
  const apiKey = credentials.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "STRIPE_SECRET_KEY is not configured. Please add it in Project Integrations.",
    };
  }
  if (!input.priceId) {
    return {
      success: false,
      error: "Price ID is required (price_...). Create products and prices in the Stripe dashboard.",
    };
  }
  try {
    const body = new URLSearchParams();
    body.append("line_items[0][price]", input.priceId);
    body.append("line_items[0][quantity]", input.quantity || "1");
    const response = await fetch(`${STRIPE_API_URL}/payment_links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const errorData = (await response.json()) as { error?: { message?: string } };
      return {
        success: false,
        error: errorData.error?.message || `HTTP ${response.status}: Failed to create payment link`,
      };
    }
    const link = (await response.json()) as { id: string; url: string };
    return { success: true, id: link.id, url: link.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to create payment link: ${message}` };
  }
}

export async function createPaymentLinkStep(
  input: CreatePaymentLinkInput
): Promise<Result> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
createPaymentLinkStep.maxRetries = 0;

export const _integrationType = "stripe";
