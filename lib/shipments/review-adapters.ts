/**
 * Adapters from the platform's real shipment-connector outputs to the review
 * step's EnvioShape. Mappings copied from the plugin code (source of truth):
 * - mercadolibre/get-shipment → { id, status, substatus, trackingNumber, trackingMethod, estimatedDelivery, receiverCity }
 * - zipnova/get-shipment → { status, statusDetail, tracking, raw }
 * - enviopack/get-shipment → { shipment: unknown } raw passthrough: taxonomy
 *   NOT verified, so it is skipped with an advertencia instead of guessed.
 *
 * Contract gap: no connector exposes "days in current state", so demora alerts
 * (diasEnEstado) only work when the workflow computes that field itself; with
 * real connector data only state-based alerts fire.
 */
import type { EnvioShape } from "./review-shared";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type AdaptEnviosResult = {
  envios: EnvioShape[];
  omitidos: number;
  advertencias: string[];
};

function isMlShipment(r: Record<string, unknown>): boolean {
  return typeof r.id === "string" && typeof r.status === "string" && "trackingNumber" in r;
}

function isZipnovaShipment(r: Record<string, unknown>): boolean {
  return typeof r.status === "string" && "statusDetail" in r && "tracking" in r;
}

function isEnviopackRaw(r: Record<string, unknown>): boolean {
  return "shipment" in r && typeof r.envioId !== "string";
}

/** Maps one entry; returns null when it is already an EnvioShape candidate. */
function adaptOne(entry: unknown): { envio?: EnvioShape; omitido?: boolean } {
  if (typeof entry !== "object" || entry === null) return {};
  const r = entry as Record<string, unknown>;
  if (isMlShipment(r)) {
    return {
      envio: {
        envioId: asText(r.id),
        canal: "mercadolibre",
        estado: asText(r.status),
        subestado: asText(r.substatus),
        referencia: asText(r.trackingNumber),
      },
    };
  }
  if (isZipnovaShipment(r)) {
    return {
      envio: {
        envioId: asText(r.tracking),
        canal: "zipnova",
        estado: asText(r.status),
        subestado: asText(r.statusDetail),
      },
    };
  }
  if (isEnviopackRaw(r)) {
    return { omitido: true };
  }
  return {}; // ya parece EnvioShape normalizado
}

export function ADAPT_ADVERTENCIAS(enviopackOmitidos: number): string[] {
  const out = [
    "Ningún conector informa los días en el estado actual: la alerta por demora necesita ese dato calculado aparte; con datos reales solo avisa por estado.",
  ];
  if (enviopackOmitidos > 0) {
    out.push(`Se omitieron ${enviopackOmitidos} envío(s) de Enviopack: su conector devuelve datos crudos sin taxonomía verificada y no se interpretan por las dudas.`);
  }
  return out;
}

export function adaptEnvios(entries: unknown[]): AdaptEnviosResult {
  const envios: EnvioShape[] = [];
  let omitidos = 0;
  for (const entry of entries) {
    const { envio, omitido } = adaptOne(entry);
    if (envio) envios.push(envio);
    else if (omitido) omitidos += 1;
    else envios.push(entry as EnvioShape);
  }
  return { envios, omitidos, advertencias: ADAPT_ADVERTENCIAS(omitidos) };
}
