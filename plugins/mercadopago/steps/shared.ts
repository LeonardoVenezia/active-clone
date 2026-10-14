export const MERCADOPAGO_API_URL = "https://api.mercadopago.com";

type MercadoPagoErrorBody = {
  message?: string;
  error?: string;
  cause?: Array<{ description?: string }>;
};

/**
 * Build a readable error from a failed Mercado Pago response.
 */
export async function readMercadoPagoError(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const body = (await response.json()) as MercadoPagoErrorBody;
    const cause = body.cause?.[0]?.description;
    const message = body.message || body.error;
    if (message && cause) {
      return `${message}: ${cause}`;
    }
    return message || cause || `HTTP ${response.status}: ${fallback}`;
  } catch {
    return `HTTP ${response.status}: ${fallback}`;
  }
}

export const NOT_CONFIGURED_ERROR =
  "MERCADOPAGO_ACCESS_TOKEN is not configured. Please add it in Project Integrations.";
