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
  adaptCobrosMP,
  adaptVentasML,
  adaptVentasTN,
  isOrdersEnvelope,
  isPaymentsEnvelope,
} from "../payments/reconcile-adapters";
import {
  buildVista,
  FUERA_DE_ALCANCE,
  type PagoShape,
  reconcilePayments,
  type VentaShape,
} from "../payments/reconcile-shared";
import { type StepInput, withStepLogging } from "./step-handler";

export type PaymentReconcileInput = StepInput & {
  ventas?: unknown;
  pagos?: unknown;
  canalVentas?: unknown;
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
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function maybeParseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function cleanCollectionName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseTolerancia(value: unknown): number {
  let n = Number.NaN;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number(value);
  }
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOLERANCIA;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orquesta adaptación de entradas por canal; las ramas son la regla de negocio
async function stepHandler(input: PaymentReconcileInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return {
      success: false as const,
      error: "Conciliar Pagos no está disponible para este workflow todavía.",
    };
  }

  const advertencias: string[] = [...FUERA_DE_ALCANCE];

  // Entradas: acepta la lista normalizada o la salida cruda de los conectores
  // (search-orders TN/ML, search-payments MP) con el mapeo documentado en
  // reconcile-adapters.ts. Nunca inventa campos que el conector no expone.
  let ventasRaw = maybeParseJson(input.ventas);
  if (isOrdersEnvelope(ventasRaw)) {
    const canalCfg =
      typeof input.canalVentas === "string"
        ? input.canalVentas.trim().toLowerCase()
        : "";
    const first = ventasRaw.orders[0] as Record<string, unknown> | undefined;
    let detectado = "";
    if (first && typeof first === "object") {
      if ("number" in first) {
        detectado = "tiendanube";
      } else if ("id" in first) {
        detectado = "mercadolibre";
      }
    }
    const canal =
      canalCfg === "tiendanube" || canalCfg === "mercadolibre"
        ? canalCfg
        : detectado;
    if (!canal) {
      return {
        success: false as const,
        error:
          "No pude saber si las órdenes son de Tiendanube o Mercado Libre: configurá el canal de ventas.",
      };
    }
    const adapted =
      canal === "mercadolibre"
        ? adaptVentasML(ventasRaw)
        : adaptVentasTN(ventasRaw);
    ventasRaw = adapted.items;
    advertencias.push(...adapted.advertencias);
  }

  let pagosRaw = maybeParseJson(input.pagos);
  if (isPaymentsEnvelope(pagosRaw)) {
    const adapted = adaptCobrosMP(pagosRaw);
    pagosRaw = adapted.items;
    advertencias.push(...adapted.advertencias);
  }

  const ventas = parseList(ventasRaw);
  const pagos = parseList(pagosRaw);
  if (ventas === null || pagos === null) {
    return {
      success: false as const,
      error:
        "No se pudieron leer las entradas: esperaba la lista de ventas y la de cobros (JSON).",
    };
  }

  const reporteCollection = cleanCollectionName(
    input.reporteCollection,
    DEFAULT_REPORTE_COLLECTION
  );
  const tolerancia = parseTolerancia(input.tolerancia);

  const report = reconcilePayments(
    ventas as VentaShape[],
    pagos as PagoShape[],
    tolerancia
  );
  const vista = buildVista(report.filas);
  if (input.ventasTruncadas === true || input.ventasTruncadas === "true") {
    advertencias.push(
      "La lista de ventas está incompleta: el reporte no cubre todas las ventas."
    );
  }
  if (input.pagosTruncados === true || input.pagosTruncados === "true") {
    advertencias.push(
      "La lista de cobros está incompleta: el reporte no cubre todos los cobros."
    );
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
    if (!saved.success) {
      return { success: false as const, error: saved.error };
    }
  } catch {
    // Never surface SQL or parameters (they can include the organization id).
    return {
      success: false as const,
      error: "No pudimos acceder a los datos. Probá de nuevo.",
    };
  }

  return {
    success: true as const,
    ...report,
    vista,
    advertencias,
    reporte: { collection: reporteCollection, key: REPORTE_KEY },
  };
}

export function paymentReconcileStep(input: PaymentReconcileInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
