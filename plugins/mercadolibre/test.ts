export async function testMercadoLibre(credentials: Record<string, string>) {
  try {
    const accessToken = credentials.MERCADOLIBRE_ACCESS_TOKEN;
    if (!accessToken) {
      return {
        success: false,
        error: "MERCADOLIBRE_ACCESS_TOKEN is required",
      };
    }
    // GET /users/me returns the account the token belongs to.
    const response = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: "Invalid or expired Mercado Libre access token",
        };
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
