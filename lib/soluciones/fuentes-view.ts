/**
 * Vista "Fuentes de esta solución" para el frontend por solución.
 *
 * El panel del cliente distingue cuatro estados por fuente, en vez de un
 * vacío ambiguo: desactivada (decisión de la solución), sin datos (activa,
 * sin consulta en la última ejecución), error (activa, última consulta
 * falló, p.ej. credencial faltante) y al día (última consulta correcta).
 *
 * Módulo puro (sin server-only) para pruebas offline.
 */

import type { SolutionConfig } from "./config";

export type FuenteState = "al_dia" | "sin_datos" | "error" | "desactivada";

export type FuenteView = {
  /** Clave de integración (p.ej. "tiendanube"). */
  integration: string;
  /** Nombre visible (del registro de plugins; cae a la clave). */
  label: string;
  state: FuenteState;
  /** Explicación corta, segura para mostrar al cliente. */
  detail: string;
  /** ISO de la última consulta registrada (frescura visible; ausente si nunca). */
  lastRunAt?: string;
};

/** Resultado de la última consulta de una fuente, o null si no se consultó. */
export type FuenteOutcome = {
  status: "success" | "error";
  error?: string;
  /** ISO de la consulta (timestamp del log). */
  at?: string;
} | null;

/**
 * Detalle de error para el CLIENTE: nunca nombres internos (variables de
 * entorno, claves). Un error de credencial/conexión se traduce a
 * "Falta conectar <label>"; cualquier otro fallo, al genérico.
 */
export function clientErrorDetail(label: string, error?: string): string {
  const e = (error || "").toLowerCase();
  if (
    e.includes("not configured") ||
    e.includes("not connected") ||
    e.includes("not_configured")
  ) {
    return `Falta conectar ${label}.`;
  }
  return "La última consulta falló.";
}

function humanize(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Estados por fuente declarada en la solución, en el orden de la config.
 * `outcomeFor` devuelve el resultado de la última consulta de esa fuente
 * (null si la última ejecución no la tocó). Las fuentes inactivas se
 * explican SIEMPRE, aunque nunca se hayan consultado: el panel nunca
 * muestra un vacío como si fuera éxito.
 */
export function fuentesView(
  config: SolutionConfig | null,
  outcomeFor: (integration: string) => FuenteOutcome,
  labels: Record<string, string> = {}
): FuenteView[] {
  if (!config?.sources) {
    return [];
  }
  const out: FuenteView[] = [];
  for (const [integration, state] of Object.entries(config.sources)) {
    const label = labels[integration] || humanize(integration);
    if (state === "inactive") {
      out.push({
        integration,
        label,
        state: "desactivada",
        detail:
          "Desactivada en la configuración de esta solución: no se consulta.",
      });
      continue;
    }
    const outcome = outcomeFor(integration);
    if (!outcome) {
      out.push({
        integration,
        label,
        state: "sin_datos",
        detail: "Sin datos todavía: la última ejecución no la consultó.",
      });
    } else if (outcome.status === "error") {
      out.push({
        integration,
        label,
        state: "error",
        detail: clientErrorDetail(label, outcome.error),
        ...(outcome.at ? { lastRunAt: outcome.at } : {}),
      });
    } else {
      out.push({
        integration,
        label,
        state: "al_dia",
        detail: "Última consulta correcta.",
        ...(outcome.at ? { lastRunAt: outcome.at } : {}),
      });
    }
  }
  return out;
}

/** true si TODAS las fuentes declaradas están desactivadas. */
export function allSourcesInactive(fuentes: FuenteView[]): boolean {
  return fuentes.length > 0 && fuentes.every((f) => f.state === "desactivada");
}
