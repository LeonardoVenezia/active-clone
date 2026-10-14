// Envíopack API: https://developers.enviopack.com.ar/
// Auth: POST /auth with the account's API key + secret key returns an access_token
// (valid 4 hours), which is sent as the access_token query parameter.
export const ENVIOPACK_BASE = "https://api.enviopack.com";
export const NOT_CONFIGURED_ERROR =
  "Envíopack API key or secret key is not configured. Please add them in Project Integrations.";

type CredentialsLike = { ENVIOPACK_API_KEY?: string; ENVIOPACK_SECRET_KEY?: string };

export function hasEnviopackCredentials(credentials: CredentialsLike): boolean {
  return Boolean(credentials.ENVIOPACK_API_KEY && credentials.ENVIOPACK_SECRET_KEY);
}

export async function getEnviopackToken(credentials: CredentialsLike): Promise<string> {
  const response = await fetch(`${ENVIOPACK_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "api-key": credentials.ENVIOPACK_API_KEY ?? "",
      "secret-key": credentials.ENVIOPACK_SECRET_KEY ?? "",
    }),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 400 || response.status === 403
        ? "Invalid Envíopack API key or secret key"
        : `Envíopack auth failed: HTTP ${response.status}`
    );
  }
  const body = (await response.json()) as { token?: string; access_token?: string };
  const token = body.token ?? body.access_token;
  if (!token) throw new Error("Envíopack did not return an access token");
  return token;
}

export async function enviopackGet(credentials: CredentialsLike, path: string, query: Record<string, string | undefined>): Promise<unknown> {
  const token = await getEnviopackToken(credentials);
  const url = new URL(`${ENVIOPACK_BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, { headers: { Accept: "application/json" } });
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
