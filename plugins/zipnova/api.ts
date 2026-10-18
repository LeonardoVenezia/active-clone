// Zipnova Envíos API: https://docs.zipnova.com/envios
// Auth: HTTP Basic, API token as user and API secret as password, generated in
// Configuración > Integraciones > Gestionar credenciales y webhooks.
export const ZIPNOVA_BASE = "https://api.zipnova.com.ar/v2";
export const NOT_CONFIGURED_ERROR =
  "Zipnova API token, API secret or account ID is not configured. Please add them in Project Integrations.";

type CredentialsLike = { ZIPNOVA_API_TOKEN?: string; ZIPNOVA_API_SECRET?: string; ZIPNOVA_ACCOUNT_ID?: string };

export function hasZipnovaCredentials(credentials: CredentialsLike): boolean {
  return Boolean(credentials.ZIPNOVA_API_TOKEN && credentials.ZIPNOVA_API_SECRET && credentials.ZIPNOVA_ACCOUNT_ID);
}

export async function zipnovaRequest(
  credentials: CredentialsLike,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  query?: Record<string, string | undefined>
): Promise<unknown> {
  const basic = Buffer.from(`${credentials.ZIPNOVA_API_TOKEN}:${credentials.ZIPNOVA_API_SECRET}`).toString("base64");
  const url = new URL(`${ZIPNOVA_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Invalid Zipnova API token or secret");
    let message = "";
    try {
      const data = (await response.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? "";
    } catch {
      // ignore
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}
