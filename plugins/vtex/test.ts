import { hasVtexCredentials, vtexBaseUrl, vtexHeaders } from "./api";

export async function testVtex(credentials: Record<string, string>) {
  try {
    if (!hasVtexCredentials(credentials)) {
      return {
        success: false,
        error: "VTEX_ACCOUNT_NAME, VTEX_APP_KEY and VTEX_APP_TOKEN are required",
      };
    }
    // List orders with one result: read-only, needs the OMS permission.
    const response = await fetch(`${vtexBaseUrl(credentials)}/api/oms/pvt/orders?per_page=1`, {
      headers: vtexHeaders(credentials),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "Invalid VTEX credentials or the key lacks Order Management permission" };
      }
      return { success: false, error: `API error: HTTP ${response.status}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
