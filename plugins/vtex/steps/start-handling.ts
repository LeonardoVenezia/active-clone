import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasVtexCredentials, NOT_CONFIGURED_ERROR, readVtexError, vtexBaseUrl, vtexHeaders } from "../api";
import type { VtexCredentials } from "../credentials";

type Result = { success: true; orderId: string } | { success: false; error: string };

type Input = StepInput & { orderId: string; integrationId?: string };

// Moves an order from "ready for handling" to "handling" (VTEX start-handling).
async function stepHandler(input: Input, credentials: VtexCredentials): Promise<Result> {
  if (!hasVtexCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  const orderId = input.orderId?.toString().trim();
  if (!orderId) {
    return { success: false, error: "Order ID is required" };
  }
  try {
    const response = await fetch(`${vtexBaseUrl(credentials)}/api/oms/pvt/orders/${encodeURIComponent(orderId)}/start-handling`, {
      method: "POST",
      headers: vtexHeaders(credentials),
    });
    if (!response.ok) {
      return { success: false, error: await readVtexError(response, "Failed to start handling") };
    }
    return { success: true, orderId };
  } catch (error) {
    return { success: false, error: `Failed to start handling: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function startHandlingStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
startHandlingStep.maxRetries = 0;

export const _integrationType = "vtex";
