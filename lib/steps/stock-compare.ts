/**
 * Executable step for the "Comparar Stock" action (prototype, platform-only).
 * Reads the equivalence table from the Datos collection of the workflow's
 * organization; the organization comes ONLY from the executor-injected
 * _dataOrganizationId (resolved on the server from the workflow's scope).
 * Never calls Mercado Libre or Tiendanube: it compares the outputs of
 * previous steps (or fixture data) passed via template references.
 *
 * The report is persisted as ONE record ("ultimo") in the report collection,
 * overwritten on every run: Datos never deletes rows by design, so a single
 * overwritten record is the repetition-safe shape (no stale rows when the
 * report changes size, order, or comes back empty).
 */
import "server-only";

import { buildVista, compareStock, type MlItemShape, type StockEquivalence, type TnProductShape } from "../stock/compare-shared";
import { datosList, datosSave, DATOS_LIMITS } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import { type StepInput, withStepLogging } from "./step-handler";

export type StockCompareInput = StepInput & {
  mlItems?: unknown;
  tnProducts?: unknown;
  equivalenciasCollection?: unknown;
  reporteCollection?: unknown;
  _dataOrganizationId?: string;
};

const DEFAULT_EQ_COLLECTION = "equivalencias_sku";
const DEFAULT_REPORTE_COLLECTION = "reporte_stock";
const REPORTE_KEY = "ultimo";

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

async function stepHandler(input: StockCompareInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return { success: false as const, error: "Comparar Stock no está disponible para este workflow todavía." };
  }

  const mlItems = parseList(input.mlItems);
  const tnProducts = parseList(input.tnProducts);
  if (mlItems === null || tnProducts === null) {
    return {
      success: false as const,
      error: "No se pudieron leer las entradas: esperaba la lista de ítems de Mercado Libre y la de productos de Tiendanube (JSON).",
    };
  }

  const eqCollection = cleanCollectionName(input.equivalenciasCollection, DEFAULT_EQ_COLLECTION);
  const reporteCollection = cleanCollectionName(input.reporteCollection, DEFAULT_REPORTE_COLLECTION);

  let equivalences: StockEquivalence[] = [];
  let equivalenciasTruncadas = false;
  try {
    // Read up to the platform list cap; if the collection reaches it, say so
    // in the output instead of silently missing equivalences.
    const eqResult = await datosList(pgDatosRepo, org, { collection: eqCollection, limit: DATOS_LIMITS.maxListLimit });
    if (!eqResult.success) return { success: false as const, error: eqResult.error };
    equivalenciasTruncadas = (eqResult.count ?? 0) >= DATOS_LIMITS.maxListLimit;
    equivalences = (eqResult.records ?? [])
      .map((r) => {
        const value = r.value as { tn_sku?: unknown } | null;
        const tnSku = value && typeof value.tn_sku === "string" ? value.tn_sku : "";
        return { mlSku: r.key, tnSku };
      })
      .filter((e) => e.mlSku && e.tnSku);
  } catch {
    // Never surface SQL or parameters (they can include the organization id).
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }

  const report = compareStock(
    mlItems as MlItemShape[],
    tnProducts as TnProductShape[],
    equivalences
  );
  const vista = buildVista(report.filas);

  try {
    const saved = await datosSave(pgDatosRepo, org, {
      collection: reporteCollection,
      key: REPORTE_KEY,
      value: {
        generado: new Date().toISOString(),
        total: vista.length,
        resumen: report.resumen,
        filas: vista,
      },
    });
    if (!saved.success) return { success: false as const, error: saved.error };
  } catch {
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }

  return {
    success: true as const,
    ...report,
    vista,
    equivalenciasTruncadas,
    reporte: { collection: reporteCollection, key: REPORTE_KEY },
  };
}

export async function stockCompareStep(input: StockCompareInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
stockCompareStep.maxRetries = 0;
