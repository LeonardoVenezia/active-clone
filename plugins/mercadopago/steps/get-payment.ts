import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { MercadoPagoCredentials } from "../credentials";
import {
  MERCADOPAGO_API_URL,
  NOT_CONFIGURED_ERROR,
  readMercadoPagoError,
} from "./shared";

type MercadoPagoPayment = {
  id: number;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  description?: string | null;
  external_reference?: string | null;
  payment_method_id?: string;
  payment_type_id?: string;
  date_created?: string;
  date_approved?: string | null;
  payer?: { email?: string | null };
};

type GetPaymentResult =
  | {
      success: true;
      id: number;
      status: string;
      statusDetail: string;
      amount: number;
      currency: string;
      description: string;
      externalReference: string;
      paymentMethod: string;
      paymentType: string;
      payerEmail: string;
      dateCreated: string;
      dateApproved: string;
    }
  | { success: false; error: string };

export type GetPaymentCoreInput = {
  paymentId: string;
};

export type GetPaymentInput = StepInput &
  GetPaymentCoreInput & {
    integrationId?: string;
  };

async function stepHandler(
  input: GetPaymentCoreInput,
  credentials: MercadoPagoCredentials
): Promise<GetPaymentResult> {
  const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;

  if (!accessToken) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const paymentId = input.paymentId?.toString().trim();
  if (!paymentId) {
    return { success: false, error: "Payment ID is required" };
  }

  try {
    const response = await fetch(
      `${MERCADOPAGO_API_URL}/v1/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readMercadoPagoError(response, "Failed to get payment"),
      };
    }

    const payment = (await response.json()) as MercadoPagoPayment;
    return {
      success: true,
      id: payment.id,
      status: payment.status,
      statusDetail: payment.status_detail ?? "",
      amount: payment.transaction_amount,
      currency: payment.currency_id,
      description: payment.description ?? "",
      externalReference: payment.external_reference ?? "",
      paymentMethod: payment.payment_method_id ?? "",
      paymentType: payment.payment_type_id ?? "",
      payerEmail: payment.payer?.email ?? "",
      dateCreated: payment.date_created ?? "",
      dateApproved: payment.date_approved ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get payment: ${message}` };
  }
}

export async function getPaymentStep(
  input: GetPaymentInput
): Promise<GetPaymentResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
getPaymentStep.maxRetries = 0;

export const _integrationType = "mercadopago";
