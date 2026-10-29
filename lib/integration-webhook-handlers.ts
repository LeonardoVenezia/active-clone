import "server-only";
import type { IntegrationWebhookHandler } from "@/plugins/registry";

export async function loadWebhookHandler(type: string): Promise<IntegrationWebhookHandler> {
  switch(type) {
    case "mercadopago": return (await import("@/plugins/mercadopago/webhook")).mercadoPagoWebhook;
    case "tiendanube": return (await import("@/plugins/tiendanube/webhook")).tiendanubeWebhook;
    case "whatsapp": return (await import("@/plugins/whatsapp/webhook")).whatsappWebhook;
    case "vtex": return (await import("@/plugins/vtex/webhook")).vtexWebhook;
    case "mercadolibre": return (await import("@/plugins/mercadolibre/webhook")).mercadolibreWebhook;
    default: throw new Error("Webhooks not supported");
  }
}
