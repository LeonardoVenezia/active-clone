/**
 * Shared review logic for the "Revisar Envíos" step (pack ecommerce).
 * Pure functions, no I/O: flags shipments that need intervention — an alert
 * state (configurable, since each courier names states differently) or too
 * many days without movement — and dedupes by envioId+motivo so a repeated
 * run never re-raises the same alert. Deterministic ordering.
 */

export type EnvioShape = {
  envioId?: unknown;
  canal?: unknown;
  estado?: unknown;
  subestado?: unknown;
  diasEnEstado?: unknown;
  referencia?: unknown;
};

export type Motivo = "estado_alerta" | "sin_movimiento";

export type Alerta = {
  envioId: string;
  canal: string;
  estado: string;
  referencia: string;
  motivo: Motivo;
  detalle: string;
  marcaKey: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Las claves de Datos solo aceptan letras, números y . _ : @ - (máx 120).
function marcaKey(envioId: string, motivo: string, estado: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._:@-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${clean(envioId)}:${clean(motivo)}:${clean(estado) || "sin-estado"}`.slice(0, 120);
}

export function parseEstadosAlerta(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  return asText(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function revisarEnvios(
  envios: EnvioShape[],
  opts: { estadosAlerta?: string[]; umbralDias?: number | null }
): Alerta[] {
  const estados = new Set((opts.estadosAlerta ?? []).map((e) => e.toLowerCase()));
  const umbral = typeof opts.umbralDias === "number" && opts.umbralDias > 0 ? opts.umbralDias : null;
  const alertas: Alerta[] = [];

  for (const e of envios) {
    const envioId = asText(e.envioId);
    if (!envioId) continue;
    const estado = asText(e.estado);
    const subestado = asText(e.subestado);
    const canal = asText(e.canal);
    const referencia = asText(e.referencia);
    const compuesto = subestado ? `${estado}/${subestado}` : estado;

    if (estados.has(compuesto.toLowerCase()) || estados.has(estado.toLowerCase())) {
      alertas.push({
        envioId,
        canal,
        estado: compuesto,
        referencia,
        motivo: "estado_alerta",
        detalle: `Estado ${compuesto}`,
        marcaKey: marcaKey(envioId, "estado_alerta", compuesto),
      });
      continue; // un envío, una alerta: el estado alerta prevalece sobre la demora
    }
    const dias = asNumber(e.diasEnEstado);
    if (umbral !== null && dias !== null && dias >= umbral) {
      alertas.push({
        envioId,
        canal,
        estado: compuesto,
        referencia,
        motivo: "sin_movimiento",
        detalle: `${dias} días en estado ${compuesto || "desconocido"}`,
        marcaKey: marcaKey(envioId, "sin_movimiento", compuesto),
      });
    }
  }

  return alertas.sort((a, b) => a.marcaKey.localeCompare(b.marcaKey));
}

export type VistaRow = {
  aviso: string;
  envio: string;
  canal: string;
  estado: string;
  motivo: string;
  detalle: string;
  referencia: string;
};

const MOTIVO_LABELS: Record<Motivo, string> = {
  estado_alerta: "Estado de alerta",
  sin_movimiento: "Sin movimiento",
};

export function buildVista(alertas: Alerta[], yaAvisadas: Set<string>): VistaRow[] {
  return alertas.map((a) => ({
    aviso: yaAvisadas.has(a.marcaKey) ? "Ya avisado" : "Nuevo",
    envio: a.envioId,
    canal: a.canal,
    estado: a.estado,
    motivo: MOTIVO_LABELS[a.motivo],
    detalle: a.detalle,
    referencia: a.referencia,
  }));
}
