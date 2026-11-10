/**
 * Vistas dedicadas por caso: registro CERRADO de experiencias de frontend
 * por solución. La config del nodo "Solución" elige una por clave; una clave
 * desconocida se descarta y el panel cae a la vista genérica (nunca rompe
 * soluciones existentes: es un parámetro nuevo del Nivel 2, ver la
 * arquitectura en docs/arquitectura-soluciones-configurables.md).
 *
 * Módulo puro (sin server-only) para pruebas offline.
 */

export const SOLUTION_VIEW_KINDS = [
  "stock-alertas",
  "envios-excepciones",
  "conciliacion-diferencias",
  "avisos-borradores",
  "soporte-consultas",
] as const;

export type SolutionViewKind = (typeof SOLUTION_VIEW_KINDS)[number];

/** Clave de vista dedicada desde config libre, o undefined si no es válida. */
export function parseSolutionViewKind(
  raw: unknown
): SolutionViewKind | undefined {
  if (typeof raw !== "string") {
    return;
  }
  const key = raw.trim();
  return (SOLUTION_VIEW_KINDS as readonly string[]).includes(key)
    ? (key as SolutionViewKind)
    : undefined;
}
