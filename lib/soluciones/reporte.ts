/**
 * Extracción del reporte de un caso para las vistas dedicadas.
 *
 * Los pasos del pack escriben UN registro por corrida en la colección del
 * caso, con un contrato común: `filas` (array de objetos), `resumen`
 * (contadores del caso), `advertencias` (textos honestos de alcance),
 * `generado` (ISO), `total`, y opcionalmente `omitidos` y `fueraDeAlcance`.
 * Las vistas dedicadas leen ese contrato desde los registros del panel;
 * este módulo puro concentra el parse defensivo para componentes y tests.
 */

export type ReporteRow = Record<string, unknown>;

export type ReporteCaso = {
  rows: ReporteRow[];
  resumen: Record<string, number>;
  advertencias: string[];
  omitidos: ReporteRow[];
  fueraDeAlcance: string[];
  generado?: string;
  total?: number;
  /** ISO de actualización del registro contenedor (frescura visible). */
  updatedAt?: string;
};

type RecordLike = { value: unknown; updatedAt: string };

function asRowArray(raw: unknown): ReporteRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (r): r is ReporteRow => !!r && typeof r === "object" && !Array.isArray(r)
  );
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((x): x is string => typeof x === "string" && !!x.trim());
}

function asResumen(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Lee el reporte del caso desde los registros del panel (modo rowsField):
 * el registro MÁS RECIENTE que tenga un array en `rowsField`. Sin registro
 * válido devuelve un reporte vacío (la vista muestra su estado vacío).
 */
export function reporteFromRecords(
  records: RecordLike[] | null | undefined,
  rowsField: string
): ReporteCaso {
  const empty: ReporteCaso = {
    rows: [],
    resumen: {},
    advertencias: [],
    omitidos: [],
    fueraDeAlcance: [],
  };
  if (!(rowsField && Array.isArray(records))) {
    return empty;
  }
  const rec = records.find(
    (r) =>
      r.value &&
      typeof r.value === "object" &&
      !Array.isArray(r.value) &&
      Array.isArray((r.value as Record<string, unknown>)[rowsField])
  );
  if (!rec) {
    return empty;
  }
  const v = rec.value as Record<string, unknown>;
  return {
    rows: asRowArray(v[rowsField]),
    resumen: asResumen(v.resumen),
    advertencias: asStringArray(v.advertencias),
    omitidos: asRowArray(v.omitidos),
    fueraDeAlcance: asStringArray(v.fueraDeAlcance),
    ...(typeof v.generado === "string" ? { generado: v.generado } : {}),
    ...(typeof v.total === "number" ? { total: v.total } : {}),
    updatedAt: rec.updatedAt,
  };
}

/** Texto de celda seguro para las vistas: nunca "[object Object]". */
export function textoCelda(row: ReporteRow, field: string): string {
  const v = row[field];
  if (v === undefined || v === null) {
    return "";
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "boolean") {
    return v ? "Sí" : "No";
  }
  if (typeof v === "number") {
    return String(v);
  }
  return JSON.stringify(v);
}

/** Número de un campo cuando es interpretable (string numérico o number). */
export function numeroCampo(row: ReporteRow, field: string): number | null {
  const v = row[field];
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
