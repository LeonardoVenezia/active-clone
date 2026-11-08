/**
 * Shared assisted-support logic for the "Preparar Respuestas" step (pack
 * ecommerce). Pure functions, no I/O. Drafts answers from the order/shipment
 * context the workflow provides: never sends anything and never promises what
 * the data does not say. A human approval step downstream decides delivery.
 *
 * Safety rules:
 * - Only topics with real context get a draft (order/shipment status); an
 *   unknown or uncovered topic is routed to a human, never answered with an
 *   invented template.
 * - A draft never states a status the context does not include (sin dato).
 * - One draft per consultaId per run; the internal mark records that a
 *   draft was prepared, never that anything was sent.
 * - Deterministic ordering.
 */

export type TemaSoporte =
  | "estado_pedido"
  | "estado_envio"
  | "demora_envio"
  | "devolucion"
  | "otro";

export type Consulta = {
  consultaId?: unknown;
  cliente?: unknown;
  texto?: unknown;
  pedidoId?: unknown;
};

export type ContextoPedido = {
  estado?: string;
  detalle?: string;
};

export type Respuesta = {
  consultaId: string;
  cliente: string;
  tema: TemaSoporte;
  pedidoId: string;
  borrador: string;
  estado: "pendiente_aprobacion" | "derivar_humano";
  motivoDerivacion?: string;
  marcaKey: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Las claves de Datos solo aceptan letras, números y . _ : @ - (máx 120).
function marcaKey(consultaId: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._:@-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return clean(consultaId).slice(0, 120);
}

// Clasificación por palabras clave, conservadora: ante la duda, "otro".
export function clasificarTema(texto: string): TemaSoporte {
  const t = texto.toLowerCase();
  if (/devol|cambio|arrepent/.test(t)) return "devolucion";
  if (/demora|tarde|no llega|no llegó|cu[aá]ndo llega/.test(t)) return "demora_envio";
  if (/env[ií]o|paquete|tracking|seguimiento|d[oó]nde est[aá]/.test(t)) return "estado_envio";
  if (/pedido|orden|compra|pago/.test(t)) return "estado_pedido";
  return "otro";
}

export function prepararRespuestas(
  consultas: Consulta[],
  contextoPorPedido: Record<string, ContextoPedido>,
): Respuesta[] {
  const respuestas: Respuesta[] = [];
  for (const c of consultas) {
    const consultaId = asText(c.consultaId);
    if (!consultaId) continue;
    const cliente = asText(c.cliente);
    const pedidoId = asText(c.pedidoId);
    const texto = asText(c.texto);
    const tema = clasificarTema(texto);
    const ctx = pedidoId ? contextoPorPedido[pedidoId] : undefined;
    const base = {
      consultaId,
      cliente,
      tema,
      pedidoId,
      marcaKey: marcaKey(consultaId),
    };
    const saludo = cliente ? `Hola ${cliente}, ` : "Hola, ";

    if (tema === "otro") {
      respuestas.push({
        ...base,
        borrador: "",
        estado: "derivar_humano",
        motivoDerivacion: "Tema no cubierto por respuestas asistidas",
      });
      continue;
    }
    if (tema === "devolucion") {
      respuestas.push({
        ...base,
        borrador: "",
        estado: "derivar_humano",
        motivoDerivacion: "Devoluciones requieren decisión humana (política de la tienda)",
      });
      continue;
    }
    if (!pedidoId || !ctx) {
      respuestas.push({
        ...base,
        borrador: "",
        estado: "derivar_humano",
        motivoDerivacion: pedidoId
          ? `Sin contexto del pedido ${pedidoId}: no se responde sin dato`
          : "Consulta sin pedido identificado",
      });
      continue;
    }
    const estado = ctx.estado?.trim() || "sin dato";
    const detalle = ctx.detalle?.trim();
    const cuerpo = tema === "estado_pedido"
      ? `tu pedido ${pedidoId} está en estado: ${estado}${detalle ? ` (${detalle})` : ""}.`
      : tema === "estado_envio"
        ? `el envío de tu pedido ${pedidoId} está en estado: ${estado}${detalle ? ` (${detalle})` : ""}.`
        : `el envío de tu pedido ${pedidoId} registra estado: ${estado}${detalle ? ` (${detalle})` : ""}.`;
    respuestas.push({
      ...base,
      borrador: `${saludo}${cuerpo}`,
      estado: "pendiente_aprobacion",
    });
  }
  return respuestas.sort((a, b) => a.marcaKey.localeCompare(b.marcaKey));
}

export type VistaRespuestaRow = {
  preparacion: string;
  consulta: string;
  cliente: string;
  tema: string;
  estado: string;
  borrador: string;
};

const TEMA_LABELS: Record<TemaSoporte, string> = {
  estado_pedido: "Estado del pedido",
  estado_envio: "Estado del envío",
  demora_envio: "Demora de envío",
  devolucion: "Devolución",
  otro: "Otro",
};

export function buildVistaRespuestas(respuestas: Respuesta[], yaPreparadas: Set<string>): VistaRespuestaRow[] {
  return respuestas.map((r) => ({
    preparacion: yaPreparadas.has(r.marcaKey) ? (r.estado === "derivar_humano" ? "Derivación registrada" : "Ya preparado") : "Nuevo",
    consulta: r.consultaId,
    cliente: r.cliente,
    tema: TEMA_LABELS[r.tema],
    estado: r.estado === "pendiente_aprobacion" ? "Pendiente de aprobación" : `Deriva a humano: ${r.motivoDerivacion ?? ""}`,
    borrador: r.borrador || "(sin borrador)",
  }));
}
