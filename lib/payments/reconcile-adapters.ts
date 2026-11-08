/**
 * Adapters from the platform's real connector outputs to the reconcile step's
 * normalized shapes. Field mappings are copied from the plugin code (source of
 * truth), not invented:
 * - tiendanube/search-orders → orders[] { id:number, number:number, status, paymentStatus, total:string, currency, ... }
 * - mercadolibre/search-orders → orders[] { id:string, status, total:number, currency, buyerNickname, dateCreated }
 * - mercadopago/search-payments → payments[] { id:number, status, amount:number, currency, externalReference, payerEmail, dateCreated }
 *
 * Known contract gaps (surfaced as advertencias, never silently filled):
 * - MP connector does not expose commission/fee breakdown (search-payments nor
 *   get-payment return fee fields) → comision/neto stay "sin dato".
 * - TN↔MP matching relies on the checkout declaring the TN order number as the
 *   MP external_reference; that link is declared, not verified here.
 */
import type { PagoShape, VentaShape } from "./reconcile-shared";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type Adapted<T> = { items: T[]; advertencias: string[] };

/** True when the value looks like a connector envelope ({orders: [...]}). */
export function isOrdersEnvelope(
  value: unknown
): value is { orders: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { orders?: unknown }).orders)
  );
}

/** True when the value looks like the MP connector envelope ({payments: [...]}). */
export function isPaymentsEnvelope(
  value: unknown
): value is { payments: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { payments?: unknown }).payments)
  );
}

export function adaptVentasTN(env: { orders: unknown[] }): Adapted<VentaShape> {
  const advertencias = [
    "Referencia TN tomada del número de orden: concilia solo si el cobro MP declara ese mismo número como external_reference.",
  ];
  const items = env.orders.map((o) => {
    const r = o as Record<string, unknown>;
    const numero =
      typeof r.number === "number" && Number.isFinite(r.number)
        ? String(r.number)
        : asText(r.number);
    return {
      ordenId: numero,
      referencia: numero,
      canal: "tiendanube",
      total: asNumber(r.total), // TN devuelve total como string; inválido queda sin dato
      moneda: asText(r.currency),
    };
  });
  return { items, advertencias };
}

export function adaptVentasML(env: { orders: unknown[] }): Adapted<VentaShape> {
  const advertencias = [
    "Referencia ML tomada del id de orden: concilia solo si el cobro declara ese mismo id como referencia externa.",
  ];
  const items = env.orders.map((o) => {
    const r = o as Record<string, unknown>;
    const id = asText(r.id);
    return {
      ordenId: id,
      referencia: id,
      canal: "mercadolibre",
      total: asNumber(r.total),
      moneda: asText(r.currency),
    };
  });
  return { items, advertencias };
}

export function adaptCobrosMP(env: {
  payments: unknown[];
}): Adapted<PagoShape> {
  const advertencias = [
    "El conector de Mercado Pago no expone comisión ni neto: bruto es el monto de la transacción y el neto queda sin dato.",
  ];
  const items = env.payments.map((p) => {
    const r = p as Record<string, unknown>;
    return {
      pagoId:
        typeof r.id === "number" && Number.isFinite(r.id)
          ? String(r.id)
          : asText(r.id),
      referencia: asText(r.externalReference),
      bruto: asNumber(r.amount),
      moneda: asText(r.currency),
      estado: asText(r.status),
    };
  });
  return { items, advertencias };
}
