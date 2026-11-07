/**
 * Executable step for the "Comparar Stock" action (prototype, platform-only).
 * Reads the equivalence table from the Datos collection of the workflow's
 * organization; the organization comes ONLY from the executor-injected
 * _dataOrganizationId (resolved on the server from the workflow's scope).
 * Never calls Mercado Libre or Tiendanube: it compares the outputs of
 * previous steps (or fixture data) passed via template references.
 */
import "server-only";

import { compareStock, type MlItemShape, type StockEquivalence, type TnProductShape } from "../stock/compare-shared";
import { datosList } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import { type StepInput, withStepLogging } from "./step-handler";

export type StockCompareInput = StepInput & {
  mlItems?: unknown;
  tnProducts?: unknown;
  equivalenciasCollection?: unknown;
  _dataOrganizationId?: string;
};

const DEFAULT_EQ_COLLECTION = "equivalencias_sku";

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

  const collection =
    typeof input.equivalenciasCollection === "string" && input.equivalenciasCollection.trim()
      ? input.equivalenciasCollection.trim()
      : DEFAULT_EQ_COLLECTION;

  let equivalences: StockEquivalence[] = [];
  try {
    const eqResult = await datosList(pgDatosRepo, org, { collection });
    if (!eqResult.success) return { success: false as const, error: eqResult.error };
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
  return { success: true as const, ...report };
}

export async function stockCompareStep(input: StockCompareInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
stockCompareStep.maxRetries = 0;
