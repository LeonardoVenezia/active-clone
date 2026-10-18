// Xubio API: https://xubio.com/API/documentation/index.html
// Auth: OAuth2 client credentials. The user creates an "App Cliente" in their own
// Xubio account (Configuración > Integraciones > API de Xubio) and pastes
// Client ID + Secret ID here. Tokens last 1 hour; we request a fresh one per call.
export const XUBIO_BASE = "https://xubio.com/API/1.1";
export const NOT_CONFIGURED_ERROR =
  "Xubio Client ID or Secret ID is not configured. Please add them in Project Integrations.";

type XubioCredentialsLike = { XUBIO_CLIENT_ID?: string; XUBIO_SECRET_ID?: string };

export function hasXubioCredentials(credentials: XubioCredentialsLike): boolean {
  return Boolean(credentials.XUBIO_CLIENT_ID && credentials.XUBIO_SECRET_ID);
}

export async function getXubioToken(credentials: XubioCredentialsLike): Promise<string> {
  const basic = Buffer.from(`${credentials.XUBIO_CLIENT_ID}:${credentials.XUBIO_SECRET_ID}`).toString("base64");
  const response = await fetch(`${XUBIO_BASE}/TokenEndpoint`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 400
        ? "Invalid Xubio Client ID or Secret ID"
        : `Xubio token request failed: HTTP ${response.status}`
    );
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Xubio did not return an access token");
  return body.access_token;
}

export async function xubioGet(credentials: XubioCredentialsLike, path: string, query?: Record<string, string | undefined>): Promise<unknown> {
  const token = await getXubioToken(credentials);
  const url = new URL(`${XUBIO_BASE}/${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) {
    let message = "";
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? "";
    } catch {
      // ignore
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function xubioPost(credentials: XubioCredentialsLike, path: string, body: Record<string, unknown>): Promise<unknown> {
  const token = await getXubioToken(credentials);
  const response = await fetch(`${XUBIO_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "";
    try {
      const data = (await response.json()) as { message?: string; error?: string; error_description?: string };
      message = data.message ?? data.error_description ?? data.error ?? "";
    } catch {
      // ignore
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}
