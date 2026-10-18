// Alegra API: https://developer.alegra.com/reference/autenticaci%C3%B3n
// Auth: HTTP Basic with the user's Alegra email and API token
// (Alegra > Configuración > API - Integraciones con otros sistemas).
export const ALEGRA_BASE = "https://api.alegra.com/api/v1";
export const NOT_CONFIGURED_ERROR =
  "Alegra email or API token is not configured. Please add them in Project Integrations.";

type AlegraCredentialsLike = { ALEGRA_EMAIL?: string; ALEGRA_TOKEN?: string };

export function hasAlegraCredentials(credentials: AlegraCredentialsLike): boolean {
  return Boolean(credentials.ALEGRA_EMAIL && credentials.ALEGRA_TOKEN);
}

export async function alegraGet(credentials: AlegraCredentialsLike, path: string, query?: Record<string, string | undefined>): Promise<unknown> {
  const basic = Buffer.from(`${credentials.ALEGRA_EMAIL}:${credentials.ALEGRA_TOKEN}`).toString("base64");
  const url = new URL(`${ALEGRA_BASE}/${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, { headers: { Authorization: `Basic ${basic}`, Accept: "application/json" } });
  if (response.status === 401) {
    throw new Error("Invalid Alegra email or API token");
  }
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

export async function alegraPost(credentials: AlegraCredentialsLike, path: string, body: Record<string, unknown>): Promise<unknown> {
  const basic = Buffer.from(`${credentials.ALEGRA_EMAIL}:${credentials.ALEGRA_TOKEN}`).toString("base64");
  const response = await fetch(`${ALEGRA_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    throw new Error("Invalid Alegra email or API token");
  }
  if (!response.ok) {
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
