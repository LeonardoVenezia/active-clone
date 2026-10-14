// Tiendanube API: https://tiendanube.github.io/api-documentation/
export const TIENDANUBE_API_VERSION = "2025-03";
export const TIENDANUBE_API_URL = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}`;
// Tiendanube asks every request to identify the app.
export const TIENDANUBE_USER_AGENT = "active-clone (leovenezia@outlook.com.ar)";

export function storeUrl(storeId: string, path: string): string {
  return `${TIENDANUBE_API_URL}/${encodeURIComponent(storeId)}${path}`;
}

export function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": TIENDANUBE_USER_AGENT,
    "Content-Type": "application/json",
  };
}

type TiendanubeErrorBody = {
  description?: string;
  message?: string;
  [field: string]: unknown;
};

export async function readTiendanubeError(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const body = (await response.json()) as TiendanubeErrorBody;
    return (
      body.description ||
      body.message ||
      `HTTP ${response.status}: ${fallback}`
    );
  } catch {
    return `HTTP ${response.status}: ${fallback}`;
  }
}

export const NOT_CONFIGURED_ERROR =
  "Tiendanube access token or store ID is not configured. Please add them in Project Integrations.";
