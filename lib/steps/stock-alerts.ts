/**
 * Executable step for the "Alertas de Stock" action (pack ecommerce).
 * Report + internal dedupe marks only: never writes stock and never sends
 * notifications. Mirrors the "Revisar Envíos" shape.
 */
import "server-only";

import { datosRead, datosSave, datosSaveIfAbsent } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import {
  buildVistaStock,
  decidirMarca,
  type MarcaStock,
  type ProductoShape,
  revisarStock,
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

function cleanCollectionName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseUmbral(value: unknown): number {
  let n = Number.NaN;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    n = Number(value);
  }
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_UMBRAL;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: evaluación por producto con ramas de umbral y dedupe; las ramas son la regla de negocio
async function stepHandler(input: StockAlertsInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return {
      success: false as const,
      error: "Alertas de Stock no está disponible para este workflow todavía.",
    };
  }

  const productos = parseList(input.productos);
  if (productos === null) {
    return {
      success: false as const,
      error:
        "No se pudieron leer las entradas: esperaba la lista de productos (JSON).",
    };
  }

  const umbral = parseUmbral(input.umbral);
  const marcasCollection = cleanCollectionName(
    input.marcasCollection,
    DEFAULT_MARCAS_COLLECTION
  );
  const reporteCollection = cleanCollectionName(
    input.reporteCollection,
    DEFAULT_REPORTE_COLLECTION
  );

  const lista = productos as ProductoShape[];
  const alertas = revisarStock(lista, umbral);
  const alertaPorKey = new Map(alertas.map((a) => [a.marcaKey, a]));

  // Dedupe por episodio: marca activa silencia repeticiones; si el producto se
  // recupera, la marca se resuelve y una nueva caída cuenta como episodio nuevo.
  const yaDetectadas = new Set<string>();
  let nuevas = 0;
  try {
    for (const p of lista) {
      let identidad = "";
      if (typeof p?.productoId === "string" && p.productoId.trim()) {
        identidad = p.productoId.trim();
      } else if (typeof p?.sku === "string" && p.sku.trim()) {
        identidad = p.sku.trim();
      }
      if (!identidad) {
        continue;
      }
      // La clave depende del motivo; para productos sanos probamos ambos motivos.
      const claves = ["bajo_stock", "sin_dato"].map((m) => {
        const clean = (s: string) =>
          s
            .replace(/[^A-Za-z0-9._:@-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        return `${clean(identidad)}:${clean(m)}`.slice(0, 120);
      });
      for (const key of claves) {
        const alerta = alertaPorKey.get(key) ?? null;
        const leida = await datosRead(pgDatosRepo, org, {
          collection: marcasCollection,
          key,
        });
        if (!leida.success) {
          return { success: false as const, error: leida.error };
        }
        const existente =
          (leida.found ? (leida.record?.value as MarcaStock) : null) ?? null;
        const decision = decidirMarca(alerta, existente);
        if (decision.accion === "crear" && alerta) {
          const marca = await datosSaveIfAbsent(pgDatosRepo, org, {
            collection: marcasCollection,
            key,
            value: {
              productoId: alerta.productoId,
              motivo: alerta.motivo,
              stock: alerta.stock,
              umbral: alerta.umbral,
              estado: "activa",
            } satisfies MarcaStock,
          });
          if (!marca.success) {
            return { success: false as const, error: marca.error };
          }
          if (marca.creado) {
            nuevas += 1;
          } else {
            yaDetectadas.add(key); // carrera: otro proceso la creó activa
          }
        } else if (decision.accion === "mantener") {
          yaDetectadas.add(key);
        } else if (decision.accion === "reactivar" && alerta) {
          const value: MarcaStock = {
            productoId: alerta.productoId,
            motivo: alerta.motivo,
            stock: alerta.stock,
            umbral: alerta.umbral,
            estado: "activa",
          };
          const saved = await datosSave(pgDatosRepo, org, {
            collection: marcasCollection,
            key,
            value,
          });
          if (!saved.success) {
            return { success: false as const, error: saved.error };
          }
          nuevas += 1;
        } else if (decision.accion === "resolver" && existente) {
          const value: MarcaStock = { ...existente, estado: "resuelta" };
          const saved = await datosSave(pgDatosRepo, org, {
            collection: marcasCollection,
            key,
            value,
          });
          if (!saved.success) {
            return { success: false as const, error: saved.error };
          }
        }
      }
    }
  } catch {
    return {
      success: false as const,
      error: "No pudimos acceder a los datos. Probá de nuevo.",
    };
  }

  const vista = buildVistaStock(alertas, yaDetectadas);
  const advertencias: string[] = [
    "Solo reporte y marcas internas: no modifica stock ni envía avisos.",
  ];
  if (
    input.productosTruncados === true ||
    input.productosTruncados === "true"
  ) {
    advertencias.push(
      "La lista de productos está incompleta: puede haber alertas sin revisar."
    );
  }

  const resumen = {
    productosRevisados: (productos as ProductoShape[]).filter(
      (p) => typeof p?.productoId === "string" || typeof p?.sku === "string"
    ).length,
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
    if (!saved.success) {
      return { success: false as const, error: saved.error };
    }
  } catch {
    return {
      success: false as const,
      error: "No pudimos acceder a los datos. Probá de nuevo.",
    };
  }

  return {
    success: true as const,
    ...resumen,
    vista,
    advertencias,
    reporte: { collection: reporteCollection, key: REPORTE_KEY },
  };
}

export function stockAlertsStep(input: StockAlertsInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
