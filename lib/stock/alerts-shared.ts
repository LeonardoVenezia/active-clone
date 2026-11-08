/**
 * Shared low-stock alert logic for the "Alertas de Stock" step (pack
 * ecommerce). Pure functions, no I/O. Report + internal marks only: never
 * touches real stock and never sends notifications.
 *
 * Safety rules mirror the other pack steps:
 * - Only products with a declared, finite stock number are evaluated; a
 *   missing or non-numeric stock is reported as sin_dato, never as zero.
 * - One alert per product below its threshold; dedupe mark per product+state
 *   so reruns report "Ya detectado" instead of repeating.
 * - Deterministic ordering.
 */

export type ProductoShape = {
  productoId?: unknown;
  sku?: unknown;
  nombre?: unknown;
  stock?: unknown;
  umbral?: unknown;
};

export type AlertaStockMotivo = "bajo_stock" | "sin_dato";

export type AlertaStock = {
  productoId: string;
  sku: string;
  nombre: string;
  stock: number | null;
  umbral: number;
  motivo: AlertaStockMotivo;
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
function marcaKey(productoId: string, motivo: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._:@-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${clean(productoId)}:${clean(motivo)}`.slice(0, 120);
}

export function revisarStock(productos: ProductoShape[], umbralDefault: number): AlertaStock[] {
  const alertas: AlertaStock[] = [];
  for (const p of productos) {
    const productoId = asText(p.productoId) || asText(p.sku);
    if (!productoId) continue;
    const sku = asText(p.sku);
    const nombre = asText(p.nombre);
    const umbral = asNumber(p.umbral) ?? umbralDefault;
    const stock = asNumber(p.stock);
    if (stock === null) {
      alertas.push({
        productoId,
        sku,
        nombre,
        stock: null,
        umbral,
        motivo: "sin_dato",
        detalle: "Stock sin dato numérico: no se evalúa como cero",
        marcaKey: marcaKey(productoId, "sin_dato"),
      });
      continue;
    }
    if (stock < umbral) {
      alertas.push({
        productoId,
        sku,
        nombre,
        stock,
        umbral,
        motivo: "bajo_stock",
        detalle: `Stock ${stock} por debajo del umbral ${umbral}`,
        marcaKey: marcaKey(productoId, "bajo_stock"),
      });
    }
  }
  return alertas.sort((a, b) => a.marcaKey.localeCompare(b.marcaKey));
}

export type VistaStockRow = {
  deteccion: string;
  producto: string;
  sku: string;
  nombre: string;
  motivo: string;
  stock: string;
  umbral: number;
  detalle: string;
};

// Dedupe por episodio: una marca "activa" silencia repeticiones, pero si el
// producto se recupera (stock >= umbral) la marca pasa a "resuelta" y una
// nueva caída cuenta como episodio nuevo ("Nuevo"), no se silencia para siempre.
export type MarcaStockEstado = "activa" | "resuelta";

export type MarcaStock = {
  productoId: string;
  motivo: string;
  stock: number | null;
  umbral: number;
  estado: MarcaStockEstado;
};

export type DecisionMarca = {
  accion: "crear" | "mantener" | "reactivar" | "resolver" | "nada";
  deteccion: "Nuevo" | "Ya detectado" | null;
};

// Decisión pura dado el estado actual del producto y la marca guardada.
// alerta=null significa producto sano (stock >= umbral).
export function decidirMarca(alerta: AlertaStock | null, existente: MarcaStock | null): DecisionMarca {
  if (alerta) {
    if (!existente) return { accion: "crear", deteccion: "Nuevo" };
    if (existente.estado === "activa" && existente.motivo === alerta.motivo) {
      return { accion: "mantener", deteccion: "Ya detectado" };
    }
    // Episodio resuelto que vuelve a caer, o cambio de motivo: episodio nuevo.
    return { accion: "reactivar", deteccion: "Nuevo" };
  }
  if (existente && existente.estado === "activa") {
    return { accion: "resolver", deteccion: null };
  }
  return { accion: "nada", deteccion: null };
}

const MOTIVO_LABELS: Record<AlertaStockMotivo, string> = {
  bajo_stock: "Bajo stock",
  sin_dato: "Stock sin dato",
};

export function buildVistaStock(alertas: AlertaStock[], yaDetectadas: Set<string>): VistaStockRow[] {
  return alertas.map((a) => ({
    deteccion: yaDetectadas.has(a.marcaKey) ? "Ya detectado" : "Nuevo",
    producto: a.productoId,
    sku: a.sku,
    nombre: a.nombre,
    motivo: MOTIVO_LABELS[a.motivo],
    stock: a.stock === null ? "sin dato" : String(a.stock),
    umbral: a.umbral,
    detalle: a.detalle,
  }));
}
