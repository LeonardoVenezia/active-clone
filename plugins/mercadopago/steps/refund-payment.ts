import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { MercadoPagoCredentials } from "../credentials";
import {
  MERCADOPAGO_API_URL,
  NOT_CONFIGURED_ERROR,
  readMercadoPagoError,
} from "./shared";

type MercadoPagoRefund = {
  id: number;
  payment_id: number;
  amount: number;
  status: string;
  date_created?: string;
};

type RefundPaymentResult =
  | {
      success: true;
      id: number;
      paymentId: number;
      amount: number;
      status: string;
      dateCreated: string;
    }
  | { success: false; error: string };

export type RefundPaymentCoreInput = {
  paymentId: string;
  amount?: string;
};

export type RefundPaymentInput = StepInput &
  RefundPaymentCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: RefundPaymentCoreInput,
  credentials: MercadoPagoCredentials
): Promise<RefundPaymentResult> {
  const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;

  if (!accessToken) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const paymentId = input.paymentId?.toString().trim();
  if (!paymentId) {
    return { success: false, error: "Payment ID is required" };
  }

  // Empty amount means a full refund (empty body), as the API defines.
  const body: Record<string, number> = {};
  const rawAmount = input.amount?.toString().trim();
  if (rawAmount) {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        success: false,
        error: "Amount must be a number greater than 0 (leave empty for a full refund)",
      };
    }
    body.amount = amount;
  }

  try {
    const response = await fetch(
      `${MERCADOPAGO_API_URL}/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readMercadoPagoError(response, "Failed to refund payment"),
      };
    }

    const refund = (await response.json()) as MercadoPagoRefund;
    return {
      success: true,
      id: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      dateCreated: refund.date_created ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to refund payment: ${message}` };
  }
}

export async function refundPaymentStep(
  input: RefundPaymentInput
): Promise<RefundPaymentResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
refundPaymentStep.maxRetries = 0;

export const _integrationType = "mercadopago";
