import "server-only";
import type { ReconnectProviderAdapter } from "./reconnect";
// Inert factories: no routes or credentials are wired. Callers must establish
// tenant scope and obtain existing account identity before constructing these.
type Http = (url: string, init: RequestInit) => Promise<Response>;
function required(v: string) {
  if (!v.trim()) throw Error("Missing provider setting");
  return v;
}
function identity(v: unknown) {
  if ((typeof v !== "string" && typeof v !== "number") || !String(v).trim())
    throw Error("Missing provider identity");
  return String(v);
}
export function tiendanubeReconnectAdapter(
  settings: { appId: string; appSecret: string; expectedStoreId: string },
  http: Http,
): ReconnectProviderAdapter {
  const expected = identity(settings.expectedStoreId);
  required(settings.appId);
  required(settings.appSecret);
  return {
    type: "tiendanube",
    async exchange(code) {
      const response = await http(
        "https://www.tiendanube.com/apps/authorize/token",
        {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: settings.appId,
            client_secret: settings.appSecret,
            grant_type: "authorization_code",
            code,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const token = await response.json();
      if (
        !response.ok ||
        typeof token.access_token !== "string" ||
        !token.access_token ||
        identity(token.user_id) !== expected
      )
        throw Error("Provider identity did not match");
      // Unlike new-install callback, reconnect must not register webhooks or create another integration.
      return {
        verified: true,
        config: { accessToken: token.access_token, storeId: expected },
      };
    },
  };
}
export function mercadoLibreReconnectAdapter(
  settings: {
    appId: string;
    appSecret: string;
    redirectUri: string;
    expectedUserId: string;
    codeVerifier?: string;
  },
  http: Http,
): ReconnectProviderAdapter {
  if (
    settings.codeVerifier !== undefined &&
    !/^[A-Za-z0-9._~-]{43,128}$/.test(settings.codeVerifier)
  )
    throw Error("Invalid PKCE verifier");
  const expected = identity(settings.expectedUserId);
  required(settings.appId);
  required(settings.appSecret);
  const uri = new URL(settings.redirectUri);
  if (uri.protocol !== "https:" || uri.username || uri.password)
    throw Error("Invalid callback URL");
  return {
    type: "mercadolibre",
    async exchange(code) {
      const response = await http("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: settings.appId,
          client_secret: settings.appSecret,
          code,
          redirect_uri: uri.toString(),
          ...(settings.codeVerifier
            ? { code_verifier: settings.codeVerifier }
            : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const token = await response.json();
      if (
        !response.ok ||
        typeof token.access_token !== "string" ||
        !token.access_token ||
        typeof token.refresh_token !== "string" ||
        !token.refresh_token ||
        identity(token.user_id) !== expected
      )
        throw Error("Provider identity did not match");
      return {
        verified: true,
        config: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          userId: expected,
        },
      };
    },
  };
}
