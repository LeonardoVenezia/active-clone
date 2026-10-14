import "server-only";

import { getIntegrationById, updateIntegration } from "@/lib/db/integrations";

// Mercado Libre API: https://developers.mercadolibre.com.ar
export const ML_API_URL = "https://api.mercadolibre.com";
export const ML_AUTH_URL = "https://auth.mercadolibre.com.ar/authorization";

export const NOT_CONFIGURED_ERROR =
  "Mercado Libre is not connected. Connect your account in Project Integrations.";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  user_id?: number | string;
  message?: string;
  error?: string;
};

// Access tokens last 6 hours. Refresh tokens work once: each refresh returns
// a new one that must replace the stored one.
async function refreshAccessToken(
  integrationId: string,
  refreshToken: string
): Promise<string | null> {
  const appId = process.env.MERCADOLIBRE_APP_ID;
  const appSecret = process.env.MERCADOLIBRE_APP_SECRET;
  if (!(appId && appSecret)) {
    return null;
  }
  const response = await fetch(`${ML_API_URL}/oauth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
    }),
  });
  const token = (await response.json()) as TokenResponse;
  if (!(response.ok && token.access_token && token.refresh_token)) {
    return null;
  }
  const integration = await getIntegrationById(integrationId);
  if (integration) {
    await updateIntegration(integration.id, integration.userId, {
      config: {
        ...integration.config,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
      },
    });
  }
  return token.access_token;
}

type MlFetchResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string };

/**
 * Calls the Mercado Libre API as the connected seller. On a 401 it refreshes
 * the token once (saving the new pair) and retries.
 */
export async function mlFetch(
  integrationId: string | undefined,
  credentials: {
    MERCADOLIBRE_ACCESS_TOKEN?: string;
    MERCADOLIBRE_REFRESH_TOKEN?: string;
  },
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<MlFetchResult> {
  let accessToken = credentials.MERCADOLIBRE_ACCESS_TOKEN;
  if (!accessToken) {
    return { ok: false, status: 0, error: NOT_CONFIGURED_ERROR };
  }

  const call = (token: string) =>
    fetch(`${ML_API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  let response = await call(accessToken);
  if (
    response.status === 401 &&
    integrationId &&
    credentials.MERCADOLIBRE_REFRESH_TOKEN
  ) {
    const renewed = await refreshAccessToken(
      integrationId,
      credentials.MERCADOLIBRE_REFRESH_TOKEN
    );
    if (renewed) {
      accessToken = renewed;
      response = await call(accessToken);
    }
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const body = data as { message?: string; error?: string } | null;
    return {
      ok: false,
      status: response.status,
      error:
        body?.message ||
        body?.error ||
        `HTTP ${response.status}: Mercado Libre request failed`,
    };
  }
  return { ok: true, data };
}
