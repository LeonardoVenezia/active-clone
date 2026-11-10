/**
 * Executable step for the "Revisar Envíos" action (pack ecommerce).
 * Mirrors the "Comparar Stock" shape: reviews shipment states passed via
 * template references (or fixtures), raises each alert once per envio+motivo
 * (Datos save-if-absent marcas), and persists one overwritten report record.
 * Never calls couriers, Mercado Libre or Tiendanube itself.
 */
import "server-only";

import { datosSave, datosSaveIfAbsent } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import { adaptEnvios } from "../shipments/review-adapters";
import {
  buildVista,
  parseEstadosAlerta,
  revisarEnvios,
} from "../shipments/review-shared";
import { type StepInput, withStepLogging } from "./step-handler";

export type ShipmentReviewInput = StepInput & {
  envios?: unknown;
  estadosAlerta?: unknown;
  umbralDias?: unknown;
  marcasCollection?: unknown;
  reporteCollection?: unknown;
  enviosTruncados?: unknown;
  _dataOrganizationId?: string;
};

const DEFAULT_MARCAS_COLLECTION = "avisos_envios";
const DEFAULT_REPORTE_COLLECTION = "reporte_envios";
const REPORTE_KEY = "ultimo";

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

function parseUmbral(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : // biome-ignore lint/style/noNestedTernary: dos casos excluyentes de parseo
        typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function stepHandler(input: ShipmentReviewInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return {
      success: false as const,
      error: "Revisar Envíos no está disponible para este workflow todavía.",
    };
  }

  const envios = parseList(input.envios);
  if (envios === null) {
    return {
      success: false as const,
      error:
        "No se pudieron leer las entradas: esperaba la lista de envíos (JSON).",
    };
  }

  const estadosAlerta = parseEstadosAlerta(input.estadosAlerta);
  const umbralDias = parseUmbral(input.umbralDias);
  const marcasCollection = cleanCollectionName(
    input.marcasCollection,
    DEFAULT_MARCAS_COLLECTION
  );
  const reporteCollection = cleanCollectionName(
    input.reporteCollection,
    DEFAULT_REPORTE_COLLECTION
  );

  if (estadosAlerta.length === 0 && umbralDias === null) {
    return {
      success: false as const,
      error:
        "Configurá al menos un estado de alerta o un umbral de días sin movimiento.",
    };
  }

  // Entradas: lista normalizada o salidas crudas de los conectores de envío
  // (ML get-shipment, zipnova get-shipment) con mapeo documentado; lo crudo de
  // Enviopack se omite con advertencia, nunca se interpreta por las dudas.
  const adapted = adaptEnvios(envios);
  const alertas = revisarEnvios(adapted.envios, { estadosAlerta, umbralDias });

  // Dedupe: una marca por envío+motivo, creada solo la primera vez.
  const yaAvisadas = new Set<string>();
  let nuevas = 0;
  try {
    for (const a of alertas) {
      const marca = await datosSaveIfAbsent(pgDatosRepo, org, {
        collection: marcasCollection,
        key: a.marcaKey,
        value: {
          envioId: a.envioId,
          motivo: a.motivo,
          estado: a.estado,
          detalle: a.detalle,
        },
      });
      if (!marca.success) {
        return { success: false as const, error: marca.error };
      }
      if (marca.creado) {
        nuevas += 1;
      } else {
        yaAvisadas.add(a.marcaKey);
      }
    }
  } catch {
    return {
      success: false as const,
      error: "No pudimos acceder a los datos. Probá de nuevo.",
    };
  }

  const vista = buildVista(alertas, yaAvisadas);
  const advertencias: string[] = [...adapted.advertencias];
  if (input.enviosTruncados === true || input.enviosTruncados === "true") {
    advertencias.push(
      "La lista de envíos está incompleta: puede haber alertas sin revisar."
    );
  }

  const resumen = {
    enviosRevisados: adapted.envios.filter(
      (e) => typeof e?.envioId === "string" && e.envioId.trim()
    ).length,
    alertasNuevas: nuevas,
    yaAvisadas: yaAvisadas.size,
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

export function shipmentReviewStep(input: ShipmentReviewInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
