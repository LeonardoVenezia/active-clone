/**
 * Executable step for the "Preparar Respuestas" action (pack ecommerce).
 * Drafts support answers from workflow-provided context + send-once marks:
 * NEVER sends anything. A human Approval node downstream decides delivery.
 */
import "server-only";

import { datosSave, datosSaveIfAbsent } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import {
  buildVistaRespuestas,
  prepararRespuestas,
  type Consulta,
  type ContextoPedido,
} from "../support/assisted-shared";
import { type StepInput, withStepLogging } from "./step-handler";

export type SupportAssistInput = StepInput & {
  consultas?: unknown;
  contextoPedidos?: unknown;
  marcasCollection?: unknown;
  reporteCollection?: unknown;
  _dataOrganizationId?: string;
};

const DEFAULT_MARCAS_COLLECTION = "respuestas_soporte";
const DEFAULT_REPORTE_COLLECTION = "reporte_soporte";
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

function parseContexto(value: unknown): Record<string, ContextoPedido> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, ContextoPedido>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, ContextoPedido>;
      }
    } catch {
      // fall through
    }
  }
  return {};
}

function cleanCollectionName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function stepHandler(input: SupportAssistInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return { success: false as const, error: "Preparar Respuestas no está disponible para este workflow todavía." };
  }

  const consultas = parseList(input.consultas);
  if (consultas === null) {
    return {
      success: false as const,
      error: "No se pudieron leer las entradas: esperaba la lista de consultas (JSON).",
    };
  }

  const contexto = parseContexto(input.contextoPedidos);
  const marcasCollection = cleanCollectionName(input.marcasCollection, DEFAULT_MARCAS_COLLECTION);
  const reporteCollection = cleanCollectionName(input.reporteCollection, DEFAULT_REPORTE_COLLECTION);

  const respuestas = prepararRespuestas(consultas as Consulta[], contexto);

  // Send-once: una marca por consulta, creada solo la primera vez.
  const yaPreparadas = new Set<string>();
  let nuevas = 0;
  try {
    for (const r of respuestas) {
      const marca = await datosSaveIfAbsent(pgDatosRepo, org, {
        collection: marcasCollection,
        key: r.marcaKey,
        value: { consultaId: r.consultaId, tema: r.tema, estado: r.estado },
      });
      if (!marca.success) return { success: false as const, error: marca.error };
      if (marca.creado) nuevas += 1;
      else yaPreparadas.add(r.marcaKey);
    }
  } catch {
    return { success: false as const, error: "No pudimos acceder a los datos. Probá de nuevo." };
  }

  const vista = buildVistaRespuestas(respuestas, yaPreparadas);
  const advertencias: string[] = [
    "Solo prepara borradores y marcas internas: no envía nada. El envío requiere aprobación humana en el paso siguiente.",
    "Solo responde con el contexto provisto; lo que no tiene dato se deriva a una persona, nunca se inventa.",
  ];

  const resumen = {
    consultasRecibidas: (consultas as Consulta[]).filter((c) => typeof c?.consultaId === "string" && c.consultaId.trim()).length,
    borradoresNuevos: nuevas,
    yaPreparadas: yaPreparadas.size,
    derivadas: respuestas.filter((r) => r.estado === "derivar_humano").length,
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

export async function supportAssistStep(input: SupportAssistInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
