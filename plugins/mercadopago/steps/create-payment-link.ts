import "server-only";

// Request validation adapted from the official Mercado Pago n8n node
// (@mercadopago/n8n-nodes-mercadopago, MIT License,
// Copyright (c) 2021 MercadoPago Developers).

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import type { MercadoPagoCredentials } from "../credentials";
import {
  MERCADOPAGO_API_URL,
  NOT_CONFIGURED_ERROR,
  readMercadoPagoError,
} from "./shared";

type PreferenceResponse = {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
  external_reference?: string;
  date_of_expiration?: string | null;
};

type CreatePaymentLinkResult =
  | {
      success: true;
      id: string;
      url: string;
      sandboxUrl: string;
      externalReference: string;
      expiresAt: string;
    }
  | { success: false; error: string };

export type CreatePaymentLinkCoreInput = {
  title: string;
  unitPrice: string;
  quantity?: string;
  currency?: string;
  externalReference?: string;
  successUrl?: string;
  notificationUrl?: string;
  expirationDate?: string;
};

export type CreatePaymentLinkInput = StepInput &
  CreatePaymentLinkCoreInput & {
    integrationId?: string;
  };

const EXTERNAL_REFERENCE_REGEX = /^[A-Za-z0-9_-]+$/;
const HTTPS_REGEX = /^https:\/\//i;
const ISO_WITH_TZ_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

function validate(input: CreatePaymentLinkCoreInput): string | null {
  if (!input.title?.toString().trim()) {
    return "Title is required";
  }
  if (!(Number(input.unitPrice) > 0)) {
    return "Unit price must be a number greater than 0";
  }
  if (input.quantity && !(Number(input.quantity) > 0)) {
    return "Quantity must be a positive number";
  }
  const ref = input.externalReference?.toString().trim();
  if (ref && (ref.length > 64 || !EXTERNAL_REFERENCE_REGEX.test(ref))) {
    return "Invalid External Reference. Must be 64 characters or less and use only letters, numbers, hyphen (-) and underscore (_).";
  }
  const success = input.successUrl?.toString().trim();
  if (success && !HTTPS_REGEX.test(success)) {
    return "Success URL must start with https://";
  }
  const notification = input.notificationUrl?.toString().trim();
  if (notification && (!HTTPS_REGEX.test(notification) || notification.length > 248)) {
    return "Notification URL must start with https:// and be at most 248 characters.";
  }
  const expiration = input.expirationDate?.toString().trim();
  if (
    expiration &&
    (!ISO_WITH_TZ_REGEX.test(expiration) ||
      Number.isNaN(new Date(expiration).getTime()))
  ) {
    return "Expiration date must look like 2026-12-31T23:59:59-03:00 (with time zone).";
  }
  return null;
}

async function stepHandler(
  input: CreatePaymentLinkCoreInput,
  credentials: MercadoPagoCredentials
): Promise<CreatePaymentLinkResult> {
  const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;

  if (!accessToken) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const validationError = validate(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const body: Record<string, unknown> = {
    items: [
      {
        title: input.title.toString().trim(),
        quantity: Number(input.quantity) || 1,
        unit_price: Number(input.unitPrice),
        currency_id: input.currency?.toString().trim() || "ARS",
      },
    ],
  };

  const ref = input.externalReference?.toString().trim();
  if (ref) {
    body.external_reference = ref;
  }
  const notification = input.notificationUrl?.toString().trim();
  if (notification) {
    body.notification_url = notification;
  }
  const success = input.successUrl?.toString().trim();
  if (success) {
    body.back_urls = { success };
    body.auto_return = "approved";
  }
  const expiration = input.expirationDate?.toString().trim();
  if (expiration) {
    body.expires = true;
    body.expiration_date_to = expiration;
  }

  try {
    const response = await fetch(`${MERCADOPAGO_API_URL}/checkout/preferences`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return {
        success: false,
        error: await readMercadoPagoError(
          response,
          "Failed to create payment link"
        ),
      };
    }

    const preference = (await response.json()) as PreferenceResponse;
    return {
      success: true,
      id: preference.id,
      url: preference.init_point,
      sandboxUrl: preference.sandbox_init_point ?? "",
      externalReference: preference.external_reference ?? "",
      expiresAt: preference.date_of_expiration ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to create payment link: ${message}`,
    };
  }
}

export async function createPaymentLinkStep(
  input: CreatePaymentLinkInput
): Promise<CreatePaymentLinkResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}
createPaymentLinkStep.maxRetries = 0;

export const _integrationType = "mercadopago";
