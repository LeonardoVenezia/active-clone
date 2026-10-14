import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { hasVtexCredentials, NOT_CONFIGURED_ERROR, readVtexError, vtexBaseUrl, vtexHeaders } from "../api";
import type { VtexCredentials } from "../credentials";

type Result = { success: true; url: string; statuses: string } | { success: false; error: string };

type Input = StepInput & { notificationUrl: string; statuses?: string; integrationId?: string };

// Registers VTEX's Order Hook so status changes reach our webhook. The app key
// needs the role "Feed v3 and Hook Admin". VTEX allows ONE hook per app key,
// so this replaces any existing hook of that key. VTEX pings the URL while
// saving; the URL must therefore already be reachable (the deploy is live).
async function stepHandler(input: Input, credentials: VtexCredentials): Promise<Result> {
  if (!hasVtexCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!credentials.VTEX_HOOK_SECRET) {
    return { success: false, error: "Set a Hook Secret in the VTEX connection first" };
  }
  const url = input.notificationUrl?.toString().trim();
  if (!(url?.startsWith("https://") && url.includes("/api/integrations/webhooks/vtex/"))) {
    return { success: false, error: "Notification URL must be the https URL shown in the trigger panel" };
  }
  const statuses = (input.statuses?.toString() ?? "")
    .split(",")
    .map((status) => status.trim())
    .filter(Boolean);
  try {
    const response = await fetch(`${vtexBaseUrl(credentials)}/api/orders/hook/config`, {
      method: "POST",
      headers: vtexHeaders(credentials),
      body: JSON.stringify({
        // No statuses: VTEX's default FromWorkflow filter sends every change.
        ...(statuses.length > 0 ? { filter: { type: "FromWorkflow", status: statuses } } : {}),
        hook: { url, headers: { "x-vtex-hook-secret": credentials.VTEX_HOOK_SECRET } },
      }),
    });
    if (!response.ok) {
      return { success: false, error: await readVtexError(response, "Failed to configure the hook") };
    }
    return { success: true, url, statuses: statuses.join(",") };
  } catch (error) {
    return { success: false, error: `Failed to configure the hook: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function setupOrderHookStep(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
setupOrderHookStep.maxRetries = 0;

export const _integrationType = "vtex";
