import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { MercadoPagoCredentials } from "../credentials";
import {
  MERCADOPAGO_API_URL,
  NOT_CONFIGURED_ERROR,
  readMercadoPagoError,
} from "./shared";

type MercadoPagoPaymentSummary = {
  id: number;
  status: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
  date_created?: string;
  payer?: { email?: string | null };
};

type SearchResponse = {
  paging?: { total?: number };
  results: MercadoPagoPaymentSummary[];
};

type SearchPaymentsResult =
  | {
      success: true;
      total: number;
      count: number;
      payments: Array<{
        id: number;
        status: string;
        amount: number;
        currency: string;
        externalReference: string;
        payerEmail: string;
        dateCreated: string;
      }>;
    }
  | { success: false; error: string };

export type SearchPaymentsCoreInput = {
  externalReference?: string;
  status?: string;
  beginDate?: string;
  endDate?: string;
  limit?: string;
};

export type SearchPaymentsInput = StepInput &
  SearchPaymentsCoreInput & {
    integrationId?: string;
  };

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

async function stepHandler(
  input: SearchPaymentsCoreInput,
  credentials: MercadoPagoCredentials
): Promise<SearchPaymentsResult> {
  const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;

  if (!accessToken) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const params = new URLSearchParams({
    sort: "date_created",
    criteria: "desc",
  });

  const externalReference = input.externalReference?.toString().trim();
  if (externalReference) {
    params.set("external_reference", externalReference);
  }

  const status = input.status?.toString().trim();
  if (status && status !== "any") {
    params.set("status", status);
  }

  const beginDate = input.beginDate?.toString().trim();
  const endDate = input.endDate?.toString().trim();
  if (beginDate || endDate) {
    params.set("range", "date_created");
    if (beginDate) {
      params.set("begin_date", beginDate);
    }
    if (endDate) {
      params.set("end_date", endDate);
    }
  }

  const requestedLimit = Number(input.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
  params.set("limit", String(limit));

  try {
    const response = await fetch(
      `${MERCADOPAGO_API_URL}/v1/payments/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      return {
        success: false,
        error: await readMercadoPagoError(response, "Failed to search payments"),
      };
    }

    const data = (await response.json()) as SearchResponse;
    const payments = (data.results ?? []).map((payment) => ({
      id: payment.id,
      status: payment.status,
      amount: payment.transaction_amount,
      currency: payment.currency_id,
      externalReference: payment.external_reference ?? "",
      payerEmail: payment.payer?.email ?? "",
      dateCreated: payment.date_created ?? "",
    }));

    return {
      success: true,
      total: data.paging?.total ?? payments.length,
      count: payments.length,
      payments,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to search payments: ${message}` };
  }
}

export async function searchPaymentsStep(
  input: SearchPaymentsInput
): Promise<SearchPaymentsResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
searchPaymentsStep.maxRetries = 0;

export const _integrationType = "mercadopago";
