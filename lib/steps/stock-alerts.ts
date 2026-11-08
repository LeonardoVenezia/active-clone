/**
 * Executable step for the "Alertas de Stock" action (pack ecommerce).
 * Report + internal dedupe marks only: never writes stock and never sends
 * notifications. Mirrors the "Revisar Envíos" shape.
 */
import "server-only";

import { datosSave, datosSaveIfAbsent } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import {
  buildVistaStock,
  revisarStock,
  type ProductoShape,
} from "../stock/alerts-shared";
import { type StepInput, withStepLogging } from "./step-handler";

export type StockAlertsInput = StepInput & {
  productos?: unknown;
  umbral?: unknown;
  marcasCollection?: unknown;
  reporteCollection?: unknown;
  productosTruncados?: unknown;
  _dataOrganizationId?: string;
};

const DEFAULT_MARCAS_COLLECTION = "alertas_stock";
const DEFAULT_REPORTE_COLLECTION = "reporte_stock";
const REPORTE_KEY = "ultimo";
const DEFAULT_UMBRAL = 5;

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

function parseUmbral(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_UMBRAL;
}

async function stepHandler(input: StockAlertsInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return { success: false as const, error: "Alertas de Stock no está disponible para este workflow todavía." };
  }

  const productos = parseList(input.productos);
  if (productos === null) {
    return {
      success: false as const,
      error: "No se pudieron leer las entradas: esperaba la lista de productos (JSON).",
    };
  }

  const umbral = parseUmbral(input.umbral);
  const marcasCollection = cleanCollectionName(input.marcasCollection, DEFAULT_MARCAS_COLLECTION);
  const reporteCollection = cleanCollectionName(input.reporteCollection, DEFAULT_REPORTE_COLLECTION);

  const alertas = revisarStock(productos as ProductoShape[], umbral);

  // Dedupe: una marca por producto+motivo, creada solo la primera vez.
  const yaDetectadas = new Set<string>();
  let nuevas = 0;
  try {
    for (const a of alertas) {
      const marca = await datosSaveIfAbsent(pgDatosRepo, org, {
        collection: marcasCollection,
        key: a.marcaKey,
        value: { productoId: a.productoId, motivo: a.motivo, stock: a.stock, umbral: a.umbral },
      });
      if (!marca.success) return { success: false as const, error: marca.error };
      if (marca.creado) nuevas += 1;
      else yaDetectadas.add(a.marcaKey);
    }
  } catch {
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }

  const vista = buildVistaStock(alertas, yaDetectadas);
  const advertencias: string[] = [
    "Solo reporte y marcas internas: no modifica stock ni envía avisos.",
  ];
  if (input.productosTruncados === true || input.productosTruncados === "true") {
    advertencias.push("La lista de productos está incompleta: puede haber alertas sin revisar.");
  }

  const resumen = {
    productosRevisados: (productos as ProductoShape[]).filter((p) => typeof p?.productoId === "string" || typeof p?.sku === "string").length,
    alertasNuevas: nuevas,
    yaDetectadas: yaDetectadas.size,
  };

  try {
    const saved = await datosSave(pgDatosRepo, org, {
      collection: reporteCollection,
      key: REPORTE_KEY,
      value: {
        generado: new Date().toISOString(),
        total: vista.length,
        resumen,
        filas: vista,
        advertencias,
      },
    });
    if (!saved.success) return { success: false as const, error: saved.error };
  } catch {
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }

  return {
    success: true as const,
    ...resumen,
    vista,
    advertencias,
    reporte: { collection: reporteCollection, key: REPORTE_KEY },
  };
}

export async function stockAlertsStep(input: StockAlertsInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
