// Correo Argentino MiCorreo API:
// https://www.correoargentino.com.ar/MiCorreo/public/img/pag/apiMiCorreo.pdf
// Auth: HTTP Basic (credentials issued by Correo Argentino per environment) to get a
// JWT, then Bearer on every other call. QA is the default environment.
export const NOT_CONFIGURED_ERROR =
  "Correo Argentino user, password or customer ID is not configured. Please add them in Project Integrations.";

type CredentialsLike = {
  CORREO_ARGENTINO_USER?: string;
  CORREO_ARGENTINO_PASSWORD?: string;
  CORREO_ARGENTINO_CUSTOMER_ID?: string;
  CORREO_ARGENTINO_ENVIRONMENT?: string;
};

export function hasCorreoCredentials(credentials: CredentialsLike): boolean {
  return Boolean(
    credentials.CORREO_ARGENTINO_USER && credentials.CORREO_ARGENTINO_PASSWORD && credentials.CORREO_ARGENTINO_CUSTOMER_ID
  );
}

export function correoBaseUrl(credentials: CredentialsLike): string {
  return (credentials.CORREO_ARGENTINO_ENVIRONMENT ?? "").trim().toLowerCase() === "production"
    ? "https://api.correoargentino.com.ar/micorreo/v1"
    : "https://apitest.correoargentino.com.ar/micorreo/v1";
}

export async function getCorreoToken(credentials: CredentialsLike): Promise<string> {
  const basic = Buffer.from(`${credentials.CORREO_ARGENTINO_USER}:${credentials.CORREO_ARGENTINO_PASSWORD}`).toString("base64");
  const response = await fetch(`${correoBaseUrl(credentials)}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "Invalid Correo Argentino user or password" : `Token request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("Correo Argentino did not return a token");
  return body.token;
}

export async function correoRequest(
  credentials: CredentialsLike,
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {}
): Promise<unknown> {
  const token = await getCorreoToken(credentials);
  const url = new URL(`${correoBaseUrl(credentials)}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let message = "";
    try {
      message = ((await response.json()) as { message?: string }).message ?? "";
    } catch {
      // ignore
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}
