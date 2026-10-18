import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { MercadoPagoCredentials } from "../credentials";
import {
  MERCADOPAGO_API_URL,
  NOT_CONFIGURED_ERROR,
  readMercadoPagoError,
} from "./shared";

type CardSummary = {
  id: string;
  lastFourDigits: string;
  paymentMethod: string;
  expirationMonth: number;
  expirationYear: number;
  cardholderName: string;
};

type ListCardsResult =
  | { success: true; cards: CardSummary[]; count: number }
  | { success: false; error: string };

export type ListCardsCoreInput = {
  customerId: string;
};

export type ListCardsInput = StepInput &
  ListCardsCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: ListCardsCoreInput,
  credentials: MercadoPagoCredentials
): Promise<ListCardsResult> {
  const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const customerId = input.customerId?.toString().trim();
  if (!customerId) {
    return { success: false, error: "Customer ID is required" };
  }

  try {
    const response = await fetch(
      `${MERCADOPAGO_API_URL}/v1/customers/${encodeURIComponent(customerId)}/cards`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readMercadoPagoError(response, "Failed to list cards"),
      };
    }

    const data = (await response.json()) as Array<{
      id?: string;
      last_four_digits?: string;
      payment_method?: { name?: string };
      expiration_month?: number;
      expiration_year?: number;
      cardholder?: { name?: string };
    }>;
    const cards = (Array.isArray(data) ? data : []).map((c) => ({
      id: c.id ?? "",
      lastFourDigits: c.last_four_digits ?? "",
      paymentMethod: c.payment_method?.name ?? "",
      expirationMonth: c.expiration_month ?? 0,
      expirationYear: c.expiration_year ?? 0,
      cardholderName: c.cardholder?.name ?? "",
    }));
    return { success: true, cards, count: cards.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to list cards: ${message}` };
  }
}

export async function listCardsStep(
  input: ListCardsInput
): Promise<ListCardsResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
listCardsStep.maxRetries = 0;

export const _integrationType = "mercadopago";
