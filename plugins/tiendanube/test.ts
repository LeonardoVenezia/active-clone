import { authHeaders, storeUrl } from "./api";

export async function testTiendanube(credentials: Record<string, string>) {
  try {
    const accessToken = credentials.TIENDANUBE_ACCESS_TOKEN;
    const storeId = credentials.TIENDANUBE_STORE_ID;

    if (!(accessToken && storeId)) {
      return {
        success: false,
        error: "TIENDANUBE_ACCESS_TOKEN and TIENDANUBE_STORE_ID are required",
      };
    }

    // GET /store returns the store itself; cheap and read-only.
    const response = await fetch(storeUrl(storeId, "/store"), {
      headers: authHeaders(accessToken),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "Invalid Tiendanube access token" };
      }
      return { success: false, error: `API error: HTTP ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
