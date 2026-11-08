/**
 * Shared post-purchase notice logic for the "Preparar Avisos" step (pack
 * ecommerce). Pure functions, no I/O. Prepares drafts + send-once marks only:
 * never sends anything. A human approval step downstream decides delivery.
 *
 * Scope: transactional post-purchase events only (pago confirmado, despacho,
 * entrega). No marketing, no cross-sell: only events the buyer expects about
 * an order they already made.
 *
 * Safety rules mirror the other pack steps:
 * - One notice per order+event (send-once mark per pedido+evento).
 * - Only events on the allowed list produce drafts; anything else is skipped
 *   and reported as such, never silently mapped to another template.
 * - Deterministic ordering.
 */

export type EventoPostcompra = "pago_confirmado" | "despachado" | "entregado";

export const EVENTOS_PERMITIDOS: EventoPostcompra[] = [
  "pago_confirmado",
  "despachado",
  "entregado",
];

export type PedidoEvento = {
  pedidoId?: unknown;
  referencia?: unknown;
  evento?: unknown;
  canal?: unknown;
  cliente?: unknown;
};

export type Aviso = {
  pedidoId: string;
  referencia: string;
  evento: EventoPostcompra;
  canal: string;
  cliente: string;
  texto: string;
  estado: "pendiente_aprobacion";
  marcaKey: string;
};

export type Omitido = {
  pedidoId: string;
  evento: string;
  motivo: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Las claves de Datos solo aceptan letras, números y . _ : @ - (máx 120).
function marcaKey(pedidoId: string, evento: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._:@-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${clean(pedidoId)}:${clean(evento)}`.slice(0, 120);
}

const TEXTOS: Record<EventoPostcompra, (p: { pedidoId: string; referencia: string }) => string> = {
  pago_confirmado: ({ referencia }) =>
    `Recibimos tu pago del pedido ${referencia}. Te avisamos cuando se despache.`,
  despachado: ({ referencia }) =>
    `Tu pedido ${referencia} ya está en camino.`,
  entregado: ({ referencia }) =>
    `Tu pedido ${referencia} fue entregado. ¡Gracias por tu compra!`,
};

export function prepararAvisos(
  eventos: PedidoEvento[],
  eventosHabilitados?: EventoPostcompra[],
): { avisos: Aviso[]; omitidos: Omitido[] } {
  const habilitados = new Set(eventosHabilitados && eventosHabilitados.length > 0 ? eventosHabilitados : EVENTOS_PERMITIDOS);
  const avisos: Aviso[] = [];
  const omitidos: Omitido[] = [];
  for (const e of eventos) {
    const pedidoId = asText(e.pedidoId);
    const eventoRaw = asText(e.evento);
    if (!pedidoId) continue;
    const referencia = asText(e.referencia) || pedidoId;
    if (!EVENTOS_PERMITIDOS.includes(eventoRaw as EventoPostcompra)) {
      omitidos.push({
        pedidoId,
        evento: eventoRaw || "(vacío)",
        motivo: "Evento no permitido: solo avisos transaccionales de postcompra",
      });
      continue;
    }
    if (!habilitados.has(eventoRaw as EventoPostcompra)) {
      omitidos.push({ pedidoId, evento: eventoRaw, motivo: "Evento no habilitado en la configuración del paso" });
      continue;
    }
    const evento = eventoRaw as EventoPostcompra;
    avisos.push({
      pedidoId,
      referencia,
      evento,
      canal: asText(e.canal),
      cliente: asText(e.cliente),
      texto: TEXTOS[evento]({ pedidoId, referencia }),
      estado: "pendiente_aprobacion",
      marcaKey: marcaKey(pedidoId, evento),
    });
  }
  avisos.sort((a, b) => a.marcaKey.localeCompare(b.marcaKey));
  omitidos.sort((a, b) => a.pedidoId.localeCompare(b.pedidoId));
  return { avisos, omitidos };
}

export type VistaAvisoRow = {
  preparacion: string;
  pedido: string;
  referencia: string;
  evento: string;
  canal: string;
  texto: string;
};

const EVENTO_LABELS: Record<EventoPostcompra, string> = {
  pago_confirmado: "Pago confirmado",
  despachado: "Despachado",
  entregado: "Entregado",
};

export function buildVistaAvisos(avisos: Aviso[], yaPreparados: Set<string>): VistaAvisoRow[] {
  return avisos.map((a) => ({
    preparacion: yaPreparados.has(a.marcaKey) ? "Ya preparado" : "Nuevo",
    pedido: a.pedidoId,
    referencia: a.referencia,
    evento: EVENTO_LABELS[a.evento],
    canal: a.canal,
    texto: a.texto,
  }));
}
