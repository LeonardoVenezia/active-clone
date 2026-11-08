/**
 * Executable step for the "Conciliar Pagos" action (pack ecommerce).
 * Mirrors the "Comparar Stock" shape: pure comparison of step outputs (or
 * fixture data) passed via template references, one overwritten report record
 * in the workflow organization's Datos collection. Never calls Mercado Pago,
 * Mercado Libre or Tiendanube itself; the workflow feeds the lists.
 */
import "server-only";

import { datosSave } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import {
  buildVista,
  FUERA_DE_ALCANCE,
  reconcilePayments,
  type PagoShape,
  type VentaShape,
} from "../payments/reconcile-shared";
import { type StepInput, withStepLogging } from "./step-handler";

export type PaymentReconcileInput = StepInput & {
  ventas?: unknown;
  pagos?: unknown;
  tolerancia?: unknown;
  reporteCollection?: unknown;
  ventasTruncadas?: unknown;
  pagosTruncados?: unknown;
  _dataOrganizationId?: string;
};

const DEFAULT_REPORTE_COLLECTION = "reporte_conciliacion";
const REPORTE_KEY = "ultimo";
const DEFAULT_TOLERANCIA = 1;

function parseList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function cleanCollectionName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseTolerancia(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOLERANCIA;
}

async function stepHandler(input: PaymentReconcileInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return { success: false as const, error: "Conciliar Pagos no está disponible para este workflow todavía." };
  }

  const ventas = parseList(input.ventas);
  const pagos = parseList(input.pagos);
  if (ventas === null || pagos === null) {
    return {
      success: false as const,
      error: "No se pudieron leer las entradas: esperaba la lista de ventas y la de cobros (JSON).",
    };
  }

  const reporteCollection = cleanCollectionName(input.reporteCollection, DEFAULT_REPORTE_COLLECTION);
  const tolerancia = parseTolerancia(input.tolerancia);

  const report = reconcilePayments(ventas as VentaShape[], pagos as PagoShape[], tolerancia);
  const vista = buildVista(report.filas);

  // Anything that makes the reconciliation partial must be visible in the
  // saved report, never look like a full answer.
  const advertencias: string[] = [...FUERA_DE_ALCANCE];
  if (input.ventasTruncadas === true || input.ventasTruncadas === "true") {
    advertencias.push("La lista de ventas está incompleta: el reporte no cubre todas las ventas.");
  }
  if (input.pagosTruncados === true || input.pagosTruncados === "true") {
    advertencias.push("La lista de cobros está incompleta: el reporte no cubre todos los cobros.");
  }

  try {
    const saved = await datosSave(pgDatosRepo, org, {
      collection: reporteCollection,
      key: REPORTE_KEY,
      value: {
        generado: new Date().toISOString(),
        total: vista.length,
        resumen: report.resumen,
        filas: vista,
        advertencias,
        fueraDeAlcance: FUERA_DE_ALCANCE,
      },
    });
    if (!saved.success) return { success: false as const, error: saved.error };
  } catch {
    // Never surface SQL or parameters (they can include the organization id).
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }

  return {
    success: true as const,
    ...report,
    vista,
    advertencias,
    reporte: { collection: reporteCollection, key: REPORTE_KEY },
  };
}

export async function paymentReconcileStep(input: PaymentReconcileInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
