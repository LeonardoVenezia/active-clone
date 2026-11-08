/**
 * Executable step for the "Preparar Avisos" action (pack ecommerce).
 * Drafts permitted post-purchase notices only: NEVER sends anything.
 * A human Approval node downstream decides delivery, through the channel
 * the company already uses. Marks only record that a draft was prepared:
 * they never mean "sent" and never block re-preparing an unsent draft.
 */
import "server-only";

import { datosSave, datosSaveIfAbsent } from "../datos/core";
import { pgDatosRepo } from "../datos/repo";
import {
  buildVistaAvisos,
  type EventoPostcompra,
  type PedidoEvento,
  prepararAvisos,
} from "../notices/postpurchase-shared";
import { type StepInput, withStepLogging } from "./step-handler";

export type PostpurchaseNoticesInput = StepInput & {
  eventos?: unknown;
  eventosHabilitados?: unknown;
  marcasCollection?: unknown;
  reporteCollection?: unknown;
  _dataOrganizationId?: string;
};

const DEFAULT_MARCAS_COLLECTION = "avisos_postcompra";
const DEFAULT_REPORTE_COLLECTION = "reporte_avisos";
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

function parseEventosHabilitados(
  value: unknown
): EventoPostcompra[] | undefined {
  const list = parseList(value);
  if (list === null) {
    if (typeof value === "string" && value.trim()) {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as EventoPostcompra[];
    }
    return;
  }
  return list.filter(
    (x): x is EventoPostcompra => typeof x === "string" && x.trim() !== ""
  );
}

async function stepHandler(input: PostpurchaseNoticesInput) {
  const org = input._dataOrganizationId;
  if (!org) {
    return {
      success: false as const,
      error: "Preparar Avisos no está disponible para este workflow todavía.",
    };
  }

  const eventos = parseList(input.eventos);
  if (eventos === null) {
    return {
      success: false as const,
      error:
        "No se pudieron leer las entradas: esperaba la lista de eventos de pedidos (JSON).",
    };
  }

  const marcasCollection = cleanCollectionName(
    input.marcasCollection,
    DEFAULT_MARCAS_COLLECTION
  );
  const reporteCollection = cleanCollectionName(
    input.reporteCollection,
    DEFAULT_REPORTE_COLLECTION
  );

  const { avisos, omitidos } = prepararAvisos(
    eventos as PedidoEvento[],
    parseEventosHabilitados(input.eventosHabilitados)
  );

  // Marca de borrador por pedido+evento: registra que se preparó un
  // borrador; NO significa enviado y no impide volver a prepararlo
  // (cada corrida regenera los borradores desde la entrada).
  const yaPreparados = new Set<string>();
  let nuevos = 0;
  try {
    for (const a of avisos) {
      const marca = await datosSaveIfAbsent(pgDatosRepo, org, {
        collection: marcasCollection,
        key: a.marcaKey,
        value: { pedidoId: a.pedidoId, evento: a.evento, estado: a.estado },
      });
      if (!marca.success) {
        return { success: false as const, error: marca.error };
      }
      if (marca.creado) {
        nuevos += 1;
      } else {
        yaPreparados.add(a.marcaKey);
      }
    }
  } catch {
    return {
      success: false as const,
      error: "No pudimos acceder a los datos. Probá de nuevo.",
    };
  }

  const vista = buildVistaAvisos(avisos, yaPreparados);
  const advertencias: string[] = [
    "Solo prepara borradores y marcas internas: no envía nada. El envío requiere aprobación humana en el paso siguiente.",
    "Solo eventos transaccionales de postcompra (pago, despacho, entrega): no prepara mensajes de marketing.",
  ];

  const resumen = {
    eventosRecibidos: (eventos as PedidoEvento[]).filter(
      (e) => typeof e?.pedidoId === "string" && e.pedidoId.trim()
    ).length,
    avisosNuevos: nuevos,
    yaPreparados: yaPreparados.size,
    omitidos: omitidos.length,
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
        omitidos,
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
    omitidos,
    advertencias,
    reporte: { collection: reporteCollection, key: REPORTE_KEY },
  };
}

export function postpurchaseNoticesStep(input: PostpurchaseNoticesInput) {
  "use step";

  return withStepLogging(input, () => stepHandler(input));
}
