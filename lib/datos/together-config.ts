/**
 * Editor <-> config for the Datos "aplicar cambios juntos" list. config.operations is a JSON string.
 * Text fields that hold a JSON object/array are stored as real JSON (not as text inside text), so a
 * {{@...}} reference placed inside one of its string literals is escaped exactly once by the executor.
 */
export type TogetherRow = { operation: string; collection: string; key: string; value?: string; expected?: string; field?: string; amount?: string; min?: string; max?: string; startAtZero?: boolean };
export const TOGETHER_MAX = 10;
export const TOGETHER_LABEL: Record<string, string> = { add: "Sumar a un número", saveIfAbsent: "Guardar solo si no existe", updateIfMatches: "Actualizar solo si el valor actual coincide" };
export function parseTogether(value: string): TogetherRow[] | null {
  if (!value.trim()) return [];
  try {
    const v = JSON.parse(value);
    if (!Array.isArray(v) || !v.every((r) => r && typeof r === "object" && !Array.isArray(r) && typeof r.operation === "string")) return null;
    return v.map((r) => {
      const str = (x: unknown) => (x === undefined || x === null ? undefined : typeof x === "string" ? x : JSON.stringify(x));
      return { operation: r.operation, collection: String(r.collection ?? ""), key: String(r.key ?? ""), value: str(r.value), expected: str(r.expected), field: str(r.field), amount: str(r.amount), min: str(r.min), max: str(r.max), startAtZero: r.startAtZero === true || r.startAtZero === "true" };
    });
  } catch { return null; }
}
/** Text that is a valid JSON object/array becomes that structure; anything else stays text. */
export function structured(text: string): unknown {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return text;
  try { const v = JSON.parse(t); return v !== null && typeof v === "object" ? v : text; } catch { return text; }
}
export function serializeTogether(rows: TogetherRow[]): string {
  return JSON.stringify(rows.map((r) => {
    const o: Record<string, unknown> = { operation: r.operation, collection: r.collection, key: r.key };
    if (r.operation === "saveIfAbsent" || r.operation === "updateIfMatches") o.value = structured(r.value ?? "");
    if (r.operation === "updateIfMatches") o.expected = structured(r.expected ?? "");
    if (r.operation === "add") {
      o.field = r.field ?? ""; o.amount = r.amount ?? "";
      if (r.min) o.min = r.min;
      if (r.max) o.max = r.max;
      if (r.startAtZero) o.startAtZero = true;
    }
    return o;
  }));
}

const hasRef = (t: string | undefined) => !!t && /\{\{@[^}]+\}\}/.test(t);
const NUM = /^\s*-?\d+(\.\d+)?\s*$/;
/** Readable problems per row (same rules the step applies when it runs). References {{@...}} are only checked when the text has no reference. */
export function validateTogether(rows: TogetherRow[]): { errors: string[][]; general: string[] } {
  const general: string[] = [];
  if (rows.length === 0) general.push("Agregá al menos un cambio.");
  if (rows.length > TOGETHER_MAX) general.push(`Se pueden aplicar hasta ${TOGETHER_MAX} cambios juntos.`);
  const seen = new Map<string, number>();
  const errors = rows.map((r, i) => {
    const e: string[] = [];
    if (!r.collection) e.push("Falta la colección.");
    else if (!hasRef(r.collection) && !/^[a-z0-9_]+$/.test(r.collection)) e.push("La colección usa solo minúsculas, números y _.");
    else if (r.collection.length > 40) e.push("La colección admite hasta 40 caracteres.");
    if (!r.key) e.push("Falta la clave.");
    else if (!hasRef(r.key) && !/^[A-Za-z0-9_.:@-]+$/.test(r.key)) e.push("La clave usa letras, números y . _ : @ - (sin espacios ni /).");
    else if (r.key.length > 120) e.push("La clave admite hasta 120 caracteres.");
    if (r.collection && r.key && !hasRef(r.collection) && !hasRef(r.key)) {
      const id = `${r.collection}\u0000${r.key}`;
      if (seen.has(id)) e.push(`La misma colección y clave ya está en el cambio ${(seen.get(id) as number) + 1}: cada una puede aparecer una sola vez.`);
      else seen.set(id, i);
    }
    if (r.operation === "add") {
      if (!r.field) e.push("Falta el campo numérico.");
      else if (!/^[A-Za-z0-9_]{1,40}$/.test(r.field)) e.push("El campo usa letras, números y _ (hasta 40).");
      if (!r.amount) e.push("Falta la cantidad a sumar.");
      else if (!hasRef(r.amount) && !NUM.test(r.amount)) e.push("La cantidad debe ser un número (por ejemplo -1).");
      for (const [k, label] of [["min", "mínimo"], ["max", "máximo"]] as const) {
        const v = r[k];
        if (v && !hasRef(v) && !NUM.test(v)) e.push(`El ${label} debe ser un número.`);
      }
      if (r.min && r.max && NUM.test(r.min) && NUM.test(r.max) && Number(r.min) > Number(r.max)) e.push("El mínimo no puede ser mayor que el máximo.");
    }
    for (const [k, label] of [["value", "El valor"], ["expected", "El valor esperado"]] as const) {
      const t = r[k];
      if ((k === "value" && r.operation !== "add") || (k === "expected" && r.operation === "updateIfMatches")) {
        if (t === undefined || t === "") { if (k === "value") e.push("Falta el valor."); else e.push("Falta el valor esperado."); }
        else if (/^\s*[{[]/.test(t) && !hasRef(t)) { try { JSON.parse(t); } catch { e.push(`${label} parece JSON pero no es válido: se guardaría como texto.`); } }
        if (t && new TextEncoder().encode(t).length > 16384) e.push(`${label} supera el máximo de 16 KB.`);
      }
    }
    return e;
  });
  return { errors, general };
}

/** True when the editor draft text and the stored row text mean the same thing (so the draft can keep its own spacing). */
export function sameValueText(draft: string, stored: string): boolean {
  return JSON.stringify(structured(draft)) === JSON.stringify(structured(stored));
}

/** What will be saved for a Valor / Valor esperado text. Honest about what is only known at run time. */
export function valueKindHint(text: string | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const ref = /\{\{@[^}]+\}\}/.test(t);
  if (/^\{\{@[^}]+\}\}$/.test(t)) return "Con una sola referencia, el tipo depende de lo que traiga: un objeto o una lista se guarda como tal; cualquier otro dato, como texto.";
  if (t.startsWith("{") || t.startsWith("[")) {
    try { JSON.parse(t); return t.startsWith("[") ? "Se guardará como lista." : "Se guardará como objeto."; } catch { /* below */ }
    if (ref) return "Se guardará como objeto o lista solo si, con las referencias ya reemplazadas, el texto es JSON válido; si no, se guarda como texto. Para que sea seguro, poné las referencias de texto entre comillas dentro del JSON.";
    return "Se guardaría como texto: el JSON no es válido.";
  }
  if (ref) return "Las referencias se reemplazan al ejecutar. Si el resultado es un número, verdadero/falso, null, un objeto o una lista, se guarda con ese tipo; si no, como texto.";
  return "Se guardará como texto.";
}
