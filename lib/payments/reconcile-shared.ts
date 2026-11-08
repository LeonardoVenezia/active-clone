/**
 * Shared reconciliation logic for the "Conciliar Pagos" step (pack ecommerce).
 * Pure functions, no I/O: matches sales (TN orders, ML orders) against payment
 * processor records (Mercado Pago) by explicit external reference and
 * classifies each row. Deterministic ordering so a report diff only reflects
 * data changes.
 *
 * Matching safety rules (no false "conciliado"):
 * - Matches only by the explicit `referencia` field; ordenId is never used as
 *   a payment reference.
 * - A reference shared by several sales, or by several payments, is ambiguous:
 *   every involved row is flagged, never auto-paired or auto-summed (partial
 *   payments, retries and duplicates stay visible).
 * - Only accredited payments match: a payment with an estado that is not
 *   approved/paid is reported as `pago_no_acreditado`, never as a cobro.
 * - If both sides carry a currency and they differ, the row is ambiguous
 *   (`moneda_distinta`), never compared numerically.
 * - Missing, non-numeric or non-finite amounts are reported as
 *   `sin_datos_monto`, never treated as zero and never silently conciliado.
 *
 * Explicitly out of scope (declared to the user, not guessed): refunds,
 * chargebacks, installments/partial captures, automatic multi-currency
 * conversion, and amount+date fuzzy matching.
 */

export type VentaShape = {
  canal?: unknown;
  ordenId?: unknown;
  referencia?: unknown;
  total?: unknown;
  moneda?: unknown;
};

export type PagoShape = {
  pagoId?: unknown;
  referencia?: unknown;
  bruto?: unknown;
  comision?: unknown;
  neto?: unknown;
  moneda?: unknown;
  estado?: unknown;
};

export type ReconcileEstado =
  | "conciliado"
  | "diferencia_monto"
  | "venta_sin_cobro"
  | "cobro_sin_venta"
  | "pago_no_acreditado"
  | "ambiguo"
  | "sin_datos_monto";

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
  detalle: string;
};

export type ReconcileResumen = {
  ventas: number;
  pagos: number;
  conciliados: number;
  diferencias: number;
  ventasSinCobro: number;
  cobrosSinVenta: number;
  pagosNoAcreditados: number;
  ambiguos: number;
  sinDatosMonto: number;
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
  detalle: string;
};

export const ESTADO_LABELS: Record<ReconcileEstado, string> = {
  conciliado: "Conciliado",
  diferencia_monto: "Diferencia de monto",
  venta_sin_cobro: "Venta sin cobro",
  cobro_sin_venta: "Cobro sin venta",
  pago_no_acreditado: "Pago no acreditado",
  ambiguo: "Revisar a mano",
  sin_datos_monto: "Monto sin dato",
};

const DEFAULT_TOLERANCIA = 1; // unidades mínimas de la moneda: redondeos menores no se reportan

const ESTADOS_ACREDITADOS = new Set([
  "approved",
  "aprobado",
  "acreditado",
  "accredited",
  "pagado",
  "paid",
  "success",
]);

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pagoAcreditado(p: PagoShape): boolean {
  const est = asText(p.estado).toLowerCase();
  // Sin estado declarado no se asume acreditado: el llamador debe filtrar o declarar.
  return est !== "" && ESTADOS_ACREDITADOS.has(est);
}

function sortRows(rows: ReconcileRow[]): ReconcileRow[] {
  const order: Record<ReconcileEstado, number> = {
    ambiguo: 0,
    diferencia_monto: 1,
    sin_datos_monto: 2,
    venta_sin_cobro: 3,
    pago_no_acreditado: 4,
    cobro_sin_venta: 5,
    conciliado: 6,
  };
  return [...rows].sort(
    (a, b) =>
      order[a.estado] - order[b.estado] ||
      a.referencia.localeCompare(b.referencia)
  );
}

function baseRow(
  v: VentaShape
): Omit<
  ReconcileRow,
  "estado" | "detalle" | "pagoId" | "bruto" | "comision" | "neto"
> {
  return {
    referencia: asText(v.referencia),
    canal: asText(v.canal),
    ordenId: asText(v.ordenId),
    totalVenta: asNumber(v.total),
  };
}

function pagoCampos(p: PagoShape) {
  return {
    pagoId: asText(p.pagoId),
    bruto: asNumber(p.bruto),
    comision: asNumber(p.comision),
    neto: asNumber(p.neto),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: conciliación con reglas por prioridad; las ramas son la regla de negocio
export function reconcilePayments(
  ventas: VentaShape[],
  pagos: PagoShape[],
  tolerancia: number = DEFAULT_TOLERANCIA
): { filas: ReconcileRow[]; resumen: ReconcileResumen } {
  const ventasConRef = ventas.filter((v) => asText(v.referencia));
  const pagosConRef = pagos.filter((p) => asText(p.referencia));

  const ventasPorRef = new Map<string, VentaShape[]>();
  for (const v of ventasConRef) {
    const ref = asText(v.referencia);
    ventasPorRef.set(ref, [...(ventasPorRef.get(ref) ?? []), v]);
  }
  const pagosPorRef = new Map<string, PagoShape[]>();
  for (const p of pagosConRef) {
    const ref = asText(p.referencia);
    pagosPorRef.set(ref, [...(pagosPorRef.get(ref) ?? []), p]);
  }

  const filas: ReconcileRow[] = [];

  for (const [ref, grupoVentas] of ventasPorRef) {
    const grupoPagos = pagosPorRef.get(ref) ?? [];
    const acreditados = grupoPagos.filter(pagoAcreditado);
    const noAcreditados = grupoPagos.filter((p) => !pagoAcreditado(p));

    // Referencia compartida por varias ventas o varios cobros: ambiguo, nunca emparejado.
    if (grupoVentas.length > 1 || acreditados.length > 1) {
      for (const v of grupoVentas) {
        filas.push({
          ...baseRow(v),
          pagoId: "",
          bruto: null,
          comision: null,
          neto: null,
          estado: "ambiguo",
          detalle:
            grupoVentas.length > 1
              ? `La referencia aparece en ${grupoVentas.length} ventas; no se empareja solo.`
              : `La referencia tiene ${acreditados.length} cobros acreditados; pueden ser pagos parciales o reintentos.`,
        });
      }
      for (const p of acreditados) {
        filas.push({
          referencia: ref,
          canal: "",
          ordenId: "",
          ...pagoCampos(p),
          totalVenta: null,
          estado: "ambiguo",
          detalle: `Cobro ${asText(p.pagoId) || "sin id"} comparte referencia con otro cobro o venta.`,
        });
      }
      for (const p of noAcreditados) {
        filas.push({
          referencia: ref,
          canal: "",
          ordenId: "",
          ...pagoCampos(p),
          totalVenta: null,
          estado: "pago_no_acreditado",
          detalle: `Estado del cobro: ${asText(p.estado) || "sin declarar"}.`,
        });
      }
      continue;
    }

    const venta = grupoVentas[0];
    const pago = acreditados[0];
    for (const p of noAcreditados) {
      filas.push({
        referencia: ref,
        canal: "",
        ordenId: "",
        ...pagoCampos(p),
        totalVenta: null,
        estado: "pago_no_acreditado",
        detalle: `Estado del cobro: ${asText(p.estado) || "sin declarar"}.`,
      });
    }

    if (!pago) {
      filas.push({
        ...baseRow(venta),
        pagoId: "",
        bruto: null,
        comision: null,
        neto: null,
        estado: "venta_sin_cobro",
        detalle: "",
      });
      continue;
    }

    const monedaVenta = asText(venta.moneda).toUpperCase();
    const monedaPago = asText(pago.moneda).toUpperCase();
    if (monedaVenta && monedaPago && monedaVenta !== monedaPago) {
      filas.push({
        ...baseRow(venta),
        ...pagoCampos(pago),
        estado: "ambiguo",
        detalle: `Monedas distintas (venta ${monedaVenta}, cobro ${monedaPago}); no se comparan montos.`,
      });
      continue;
    }

    const totalVenta = asNumber(venta.total);
    const bruto = asNumber(pago.bruto);
    if (totalVenta === null || bruto === null) {
      filas.push({
        ...baseRow(venta),
        ...pagoCampos(pago),
        estado: "sin_datos_monto",
        detalle:
          "Falta el total de la venta o el bruto del cobro, o no es un número finito.",
      });
      continue;
    }

    filas.push({
      ...baseRow(venta),
      ...pagoCampos(pago),
      estado:
        Math.abs(bruto - totalVenta) > tolerancia
          ? "diferencia_monto"
          : "conciliado",
      detalle: "",
    });
  }

  // Cobros cuya referencia no aparece en ninguna venta.
  for (const [ref, grupoPagos] of pagosPorRef) {
    if (ventasPorRef.has(ref)) {
      continue;
    }
    for (const p of grupoPagos) {
      filas.push({
        referencia: ref,
        canal: "",
        ordenId: "",
        ...pagoCampos(p),
        totalVenta: null,
        estado: pagoAcreditado(p) ? "cobro_sin_venta" : "pago_no_acreditado",
        detalle: pagoAcreditado(p)
          ? ""
          : `Estado del cobro: ${asText(p.estado) || "sin declarar"}.`,
      });
    }
  }

  const ordenadas = sortRows(filas);
  const cuenta = (e: ReconcileEstado) =>
    ordenadas.filter((f) => f.estado === e).length;
  return {
    filas: ordenadas,
    resumen: {
      ventas: ventasConRef.length,
      pagos: pagosConRef.length,
      conciliados: cuenta("conciliado"),
      diferencias: cuenta("diferencia_monto"),
      ventasSinCobro: cuenta("venta_sin_cobro"),
      cobrosSinVenta: cuenta("cobro_sin_venta"),
      pagosNoAcreditados: cuenta("pago_no_acreditado"),
      ambiguos: cuenta("ambiguo"),
      sinDatosMonto: cuenta("sin_datos_monto"),
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
    detalle: r.detalle,
  }));
}

export const FUERA_DE_ALCANCE = [
  "Reembolsos y contracargos no se netean: aparecen como cobros o movimientos separados.",
  "Pagos parciales o en cuotas sobre una misma venta no se suman: se marcan para revisar a mano.",
  "No hay conversión de monedas: montos en monedas distintas no se comparan.",
  "No hay matching por monto y fecha: solo por la referencia externa declarada.",
];
