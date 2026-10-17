import "server-only";

import {
  type DecryptedIntegration,
  updateIntegration,
} from "@/lib/db/integrations";
import { MP_TOKEN_URL } from "./api";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRES_IN = 21600; // 6 hours, per MP OAuth docs

type RefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

/**
 * Return the integration with a usable access token, refreshing it through
 * Mercado Pago OAuth when it is expired (or has no recorded expiry, as with
 * connections saved before refresh wiring). MP rotates the refresh token on
 * every refresh and it lasts 6 months, so the new pair is persisted.
 * Manual connections (access token only) pass through unchanged, and a
 * failed refresh returns the original integration so the real API call
 * surfaces the auth error instead of hiding it.
 */
export async function withFreshMercadoPagoToken(
  integration: DecryptedIntegration
): Promise<DecryptedIntegration> {
  const { accessToken, refreshToken, expiresAt } = integration.config;
  if (!refreshToken) {
    return integration;
  }
  if (accessToken && expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (!Number.isNaN(expiry) && expiry - REFRESH_BUFFER_MS > Date.now()) {
      return integration;
    }
  }
  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    return integration;
  }
  try {
    const response = await fetch(MP_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const token = (await response.json()) as RefreshResponse;
    if (!(response.ok && token.access_token && token.refresh_token)) {
      console.error("[Mercado Pago OAuth] Refresh failed:", response.status);
      return integration;
    }
    const config = {
      ...integration.config,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(
        Date.now() + (token.expires_in ?? DEFAULT_EXPIRES_IN) * 1000
      ).toISOString(),
    };
    const updated = await updateIntegration(integration.id, integration.userId, {
      config,
    });
    return updated ?? { ...integration, config };
  } catch (error) {
    console.error("[Mercado Pago OAuth] Refresh error:", error);
    return integration;
  }
}
