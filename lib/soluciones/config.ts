/**
 * Solución cerrada configurable: configuración por cliente de un workflow.
 * Se declara EN UN NODO "Solución" del propio workflow (sin migraciones de
 * base de datos: el preview comparte la base con producción) y gobierna DOS cosas:
 *
 * 1. Ejecución: una fuente (integración) declarada "inactive" NO se consulta
 *    ni se espera. El paso se omite REGISTRADO, sin error, y el flujo sigue
 *    con un contrato de ausencia explícito (ver workflow-executor). "inactive"
 *    es una decisión explícita del cliente; una fuente ACTIVA sin credencial
 *    sigue FALLANDO visible (nunca se omite en silencio).
 * 2. Presentación: slots declarativos de diseño del frontend por solución.
 *
 * Módulo puro (sin server-only) para pruebas offline.
 */

export const OMITTED_MARKER = "__solutionOmitted";

/** actionType del nodo declarativo que lleva la configuración de la solución. */
export const SOLUTION_NODE_ACTION = "Solución";

export type SourceState = "active" | "inactive";

export type SolutionFrontendSlots = {
  /** Nombre visible de la solución (badge sobre el título). */
  brand?: string;
  /** Bajada descriptiva bajo el título. */
  subheading?: string;
  /** Color de acento #RGB/#RRGGBB para título y acentos. */
  accent?: string;
  /** Texto cuando la tabla está vacía. */
  emptyText?: string;
};

export type SolutionConfig = {
  name?: string;
  sources: Record<string, SourceState>;
  frontend?: SolutionFrontendSlots;
};

const INTEGRATION_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ACCENT_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function cleanText(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

function parseSources(raw: unknown): Record<string, SourceState> {
  const sources: Record<string, SourceState> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return sources;
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().toLowerCase();
    if (!INTEGRATION_KEY_RE.test(key)) {
      continue;
    }
    if (v === "active" || v === "inactive") {
      sources[key] = v;
    }
  }
  return sources;
}

function parseFrontendSlots(raw: unknown): SolutionFrontendSlots | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const f = raw as Record<string, unknown>;
  const slots: SolutionFrontendSlots = {
    brand: cleanText(f.brand, 60),
    subheading: cleanText(f.subheading, 140),
    emptyText: cleanText(f.emptyText, 120),
  };
  if (typeof f.accent === "string" && ACCENT_RE.test(f.accent.trim())) {
    slots.accent = f.accent.trim();
  }
  return slots.brand || slots.subheading || slots.accent || slots.emptyText
    ? slots
    : undefined;
}

/** Parse defensivo: lo inválido se descarta; nunca rompe un run. */
export function parseSolutionConfig(raw: unknown): SolutionConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const sources = parseSources(o.sources);
  const frontend = parseFrontendSlots(o.frontend);
  const name = cleanText(o.name, 80);
  if (!name && Object.keys(sources).length === 0 && !frontend) {
    return null;
  }
  return { name, sources, ...(frontend ? { frontend } : {}) };
}

/**
 * Integración dueña de un paso: "tiendanube/search-orders" -> "tiendanube".
 * Las acciones de sistema (Condition, Datos, Unir, Loop...) no tienen "/" y
 * NUNCA se omiten por configuración de fuentes.
 */
export function integrationFromActionType(actionType: string): string | null {
  const i = actionType.indexOf("/");
  if (i < 1) {
    return null;
  }
  const key = actionType.slice(0, i).trim().toLowerCase();
  return INTEGRATION_KEY_RE.test(key) ? key : null;
}

/** true sólo si la fuente está EXPLÍCITAMENTE inactiva en la config. */
export function isSourceInactive(
  config: SolutionConfig | null,
  integration: string
): boolean {
  return config?.sources?.[integration] === "inactive";
}

/** Contrato de ausencia: salida registrada de un paso omitido por solución. */
export function omittedSourceOutput(integration: string) {
  return {
    [OMITTED_MARKER]: true as const,
    integration,
    reason:
      "Fuente inactiva en la configuración de la solución: no se consultó ni se esperó.",
  };
}

type NodeLike = { data?: { config?: Record<string, unknown> } };

/**
 * Configuración de la solución declarada EN EL PROPIO workflow: un nodo
 * "Solución" (sin efectos, no llama proveedores) cuyos campos de texto la
 * definen. Vive en workflows.nodes (jsonb existente): sin migraciones,
 * editable en el lienzo y versionada con el flujo. El primer nodo válido
 * gana; uno inválido se ignora (workflow libre).
 *
 * Campos (todos texto, como el resto del lienzo):
 * - solutionName: nombre de la solución.
 * - sources: "tiendanube=active, mercadolibre=inactive" (pares clave=estado).
 * - brand, subheading, accent (#RGB/#RRGGBB), emptyText: slots de diseño.
 */
function parseSourcePairs(raw: unknown): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  if (typeof raw !== "string") {
    return sources;
  }
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = pair
      .slice(eq + 1)
      .trim()
      .toLowerCase();
    if (key && value) {
      sources[key] = value;
    }
  }
  return sources;
}

function configFromSolutionNode(
  c: Record<string, unknown>
): SolutionConfig | null {
  return parseSolutionConfig({
    name: c.solutionName,
    sources: parseSourcePairs(c.sources),
    frontend: {
      brand: c.brand,
      subheading: c.subheading,
      accent: c.accent,
      emptyText: c.emptyText,
    },
  });
}

export function solutionConfigFromNodes(nodes: unknown): SolutionConfig | null {
  if (!Array.isArray(nodes)) {
    return null;
  }
  for (const n of nodes as NodeLike[]) {
    const c = n?.data?.config;
    if (c?.actionType !== SOLUTION_NODE_ACTION) {
      continue;
    }
    const parsed = configFromSolutionNode(c);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

/** true si la salida registrada de un paso proviene de una omisión por solución. */
export function isOmittedOutput(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as Record<string, unknown>)[OMITTED_MARKER] === true
  );
}
