// VTEX Orders API: https://developers.vtex.com/docs/api-reference/orders-api
// Auth: X-VTEX-API-AppKey + X-VTEX-API-AppToken headers.
export const NOT_CONFIGURED_ERROR =
  "VTEX account name, app key or app token is not configured. Please add them in Project Integrations.";

type VtexCredentialsLike = {
  VTEX_ACCOUNT_NAME?: string;
  VTEX_ENVIRONMENT?: string;
  VTEX_APP_KEY?: string;
  VTEX_APP_TOKEN?: string;
};

export function hasVtexCredentials(credentials: VtexCredentialsLike): boolean {
  return Boolean(
    credentials.VTEX_ACCOUNT_NAME &&
      credentials.VTEX_APP_KEY &&
      credentials.VTEX_APP_TOKEN
  );
}

// Account names are plain slugs; reject anything else so the value can never
// change the host we call.
export function vtexBaseUrl(credentials: VtexCredentialsLike): string {
  const account = (credentials.VTEX_ACCOUNT_NAME ?? "").trim();
  const environment = (credentials.VTEX_ENVIRONMENT || "vtexcommercestable").trim();
  if (!(/^[a-z0-9-]+$/i.test(account) && /^[a-z0-9-]+$/i.test(environment))) {
    throw new Error("Invalid VTEX account name or environment");
  }
  return `https://${account}.${environment}.com.br`;
}

export function vtexHeaders(credentials: VtexCredentialsLike): Record<string, string> {
  return {
    "X-VTEX-API-AppKey": credentials.VTEX_APP_KEY ?? "",
    "X-VTEX-API-AppToken": credentials.VTEX_APP_TOKEN ?? "",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export async function readVtexError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string; message?: string };
    const message =
      typeof body.error === "string" ? body.error : body.error?.message ?? body.message;
    return message || `HTTP ${response.status}: ${fallback}`;
  } catch {
    return `HTTP ${response.status}: ${fallback}`;
  }
}
