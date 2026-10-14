// WhatsApp Business Cloud API (Meta Graph API).
// Request shapes adapted from the MIT-licensed Activepieces WhatsApp piece
// (github.com/activepieces/activepieces, packages/pieces/community/whatsapp).
export const GRAPH_VERSION = "v21.0";
export const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const NOT_CONFIGURED_ERROR =
  "WhatsApp access token or phone number ID is not configured. Please add them in Project Integrations.";

type GraphError = {
  error?: { message?: string; code?: number; error_data?: { details?: string } };
};

export type GraphResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export async function graphFetch(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<GraphResult> {
  const response = await fetch(`${GRAPH_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body; handled below by status
  }
  if (!response.ok) {
    const error = (data as GraphError).error;
    const details = error?.error_data?.details;
    return {
      ok: false,
      error:
        [error?.message, details].filter(Boolean).join(" - ") ||
        `HTTP ${response.status}: WhatsApp request failed`,
    };
  }
  return { ok: true, data };
}

// Meta wants the number in international format, digits only, no "+".
export function normalizeRecipient(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}
