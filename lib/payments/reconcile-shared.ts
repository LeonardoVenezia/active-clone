/**
 * Shared reconciliation logic for the "Conciliar Pagos" step (pack ecommerce).
 * Pure functions, no I/O: matches sales (TN orders, ML orders) against payment
 * processor records (Mercado Pago) by external reference and classifies each
 * row. Deterministic ordering so a report diff only reflects data changes.
 */

export type VentaShape = {
  canal?: unknown;
  ordenId?: unknown;
  referencia?: unknown;
  total?: unknown;
};

export type PagoShape = {
  pagoId?: unknown;
  referencia?: unknown;
  bruto?: unknown;
  comision?: unknown;
  neto?: unknown;
  moneda?: unknown;
};

export type ReconcileEstado =
  | "conciliado"
  | "diferencia_monto"
  | "venta_sin_cobro"
  | "cobro_sin_venta";

export type ReconcileRow = {
  referencia: string;
  canal: string;
  ordenId: string;
  pagoId: string;
  totalVenta: number | null;
  bruto: number | null;
  comision: number | null;
  neto: number | null;
  estado: ReconcileEstado;
};

export type ReconcileResumen = {
  ventas: number;
  pagos: number;
  conciliados: number;
  diferencias: number;
  ventasSinCobro: number;
  cobrosSinVenta: number;
};

export type VistaRow = {
  estado: string;
  referencia: string;
  canal: string;
  orden: string;
  pago: string;
  total_venta: string;
  cobrado: string;
  comision: string;
  neto: string;
};

export const ESTADO_LABELS: Record<ReconcileEstado, string> = {
  conciliado: "Conciliado",
  diferencia_monto: "Diferencia de monto",
  venta_sin_cobro: "Venta sin cobro",
  cobro_sin_venta: "Cobro sin venta",
};

const DEFAULT_TOLERANCIA = 1; // centavos de la moneda: diferencias de redondeo menores no se reportan

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sortRows(rows: ReconcileRow[]): ReconcileRow[] {
  const order: Record<ReconcileEstado, number> = {
    diferencia_monto: 0,
    venta_sin_cobro: 1,
    cobro_sin_venta: 2,
    conciliado: 3,
  };
  return [...rows].sort(
    (a, b) => order[a.estado] - order[b.estado] || a.referencia.localeCompare(b.referencia)
  );
}

export function reconcilePayments(
  ventas: VentaShape[],
  pagos: PagoShape[],
  tolerancia: number = DEFAULT_TOLERANCIA
): { filas: ReconcileRow[]; resumen: ReconcileResumen } {
  const pagosPorRef = new Map<string, PagoShape[]>();
  for (const p of pagos) {
    const ref = asText(p.referencia);
    if (!ref) continue;
    const list = pagosPorRef.get(ref) ?? [];
    list.push(p);
    pagosPorRef.set(ref, list);
  }

  const filas: ReconcileRow[] = [];
  const pagosUsados = new Set<PagoShape>();

  for (const v of ventas) {
    const ref = asText(v.referencia);
    const base = {
      referencia: ref,
      canal: asText(v.canal),
      ordenId: asText(v.ordenId),
      totalVenta: asNumber(v.total),
    };
    if (!ref) continue;
    const candidatos = (pagosPorRef.get(ref) ?? []).filter((p) => !pagosUsados.has(p));
    if (candidatos.length === 0) {
      filas.push({ ...base, pagoId: "", bruto: null, comision: null, neto: null, estado: "venta_sin_cobro" });
      continue;
    }
    const pago = candidatos[0];
    pagosUsados.add(pago);
    const bruto = asNumber(pago.bruto);
    const diferente =
      base.totalVenta !== null && bruto !== null && Math.abs(bruto - base.totalVenta) > tolerancia;
    filas.push({
      ...base,
      pagoId: asText(pago.pagoId),
      bruto,
      comision: asNumber(pago.comision),
      neto: asNumber(pago.neto),
      estado: diferente ? "diferencia_monto" : "conciliado",
    });
  }

  for (const p of pagos) {
    if (pagosUsados.has(p)) continue;
    const ref = asText(p.referencia);
    if (!ref) continue;
    filas.push({
      referencia: ref,
      canal: "",
      ordenId: "",
      pagoId: asText(p.pagoId),
      totalVenta: null,
      bruto: asNumber(p.bruto),
      comision: asNumber(p.comision),
      neto: asNumber(p.neto),
      estado: "cobro_sin_venta",
    });
  }

  const ordenadas = sortRows(filas);
  return {
    filas: ordenadas,
    resumen: {
      ventas: ventas.filter((v) => asText(v.referencia)).length,
      pagos: pagos.filter((p) => asText(p.referencia)).length,
      conciliados: ordenadas.filter((f) => f.estado === "conciliado").length,
      diferencias: ordenadas.filter((f) => f.estado === "diferencia_monto").length,
      ventasSinCobro: ordenadas.filter((f) => f.estado === "venta_sin_cobro").length,
      cobrosSinVenta: ordenadas.filter((f) => f.estado === "cobro_sin_venta").length,
    },
  };
}

function money(value: number | null): string {
  return value === null ? "sin dato" : String(value);
}

export function buildVista(filas: ReconcileRow[]): VistaRow[] {
  return filas.map((r) => ({
    estado: ESTADO_LABELS[r.estado],
    referencia: r.referencia,
    canal: r.canal,
    orden: r.ordenId,
    pago: r.pagoId,
    total_venta: money(r.totalVenta),
    cobrado: money(r.bruto),
    comision: money(r.comision),
    neto: money(r.neto),
  }));
}
