const MERCADOPAGO_API_URL = "https://api.mercadopago.com";

export async function testMercadoPago(credentials: Record<string, string>) {
  try {
    const accessToken = credentials.MERCADOPAGO_ACCESS_TOKEN;

    if (!accessToken) {
      return {
        success: false,
        error: "MERCADOPAGO_ACCESS_TOKEN is required",
      };
    }

    // Lightweight read-only call, same check as the official n8n node.
    const response = await fetch(`${MERCADOPAGO_API_URL}/v1/payment_methods`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "Invalid Mercado Pago access token" };
      }
      let detail = "";
      try {
        const body = (await response.json()) as { message?: string };
        detail = body.message ? `: ${body.message}` : "";
      } catch {
        // body was not JSON; keep the status only
      }
      return {
        success: false,
        error: `API error: HTTP ${response.status}${detail}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
