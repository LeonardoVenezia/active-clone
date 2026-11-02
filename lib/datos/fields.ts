/**
 * Optional per-collection fields for Datos (pure logic, no server-only).
 * A collection WITHOUT fields behaves exactly as before (any JSON value).
 * A collection WITH fields only accepts objects that match them on save.
 * Records saved earlier are never rewritten or re-checked.
 */
export type FieldType = "texto" | "numero" | "booleano" | "fecha";
export type FieldDef = { name: string; type: FieldType; required: boolean };

export const FIELD_LIMITS = { maxFields: 20, maxTextLength: 1000 } as const;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const TYPES: FieldType[] = ["texto", "numero", "booleano", "fecha"];

/** "nombre:tipo" or "nombre:tipo:obligatorio", one per line or separated by commas. */
export function parseFieldSpec(spec: unknown): { ok: true; fields: FieldDef[] } | { ok: false; error: string } {
  if (typeof spec !== "string" || spec.trim() === "") return { ok: false, error: "Escribí al menos un campo, por ejemplo: nombre:texto" };
  const parts = spec.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > FIELD_LIMITS.maxFields) return { ok: false, error: `Máximo ${FIELD_LIMITS.maxFields} campos.` };
  const fields: FieldDef[] = [];
  for (const p of parts) {
    const [name, type, flag, ...rest] = p.split(":").map((s) => s.trim());
    if (!name || !NAME_RE.test(name)) return { ok: false, error: `Nombre de campo inválido: "${p.slice(0, 40)}". Usá letras, números y _, empezando con letra.` };
    if (!TYPES.includes(type as FieldType)) return { ok: false, error: `Tipo inválido en "${name}". Tipos: texto, numero, booleano, fecha.` };
    if (rest.length || (flag !== undefined && flag !== "obligatorio")) return { ok: false, error: `Formato inválido en "${name}". Usá nombre:tipo o nombre:tipo:obligatorio.` };
    if (fields.some((f) => f.name === name)) return { ok: false, error: `Campo repetido: ${name}.` };
    fields.push({ name, type: type as FieldType, required: flag === "obligatorio" });
  }
  return { ok: true, fields };
}

export function isValidFieldList(v: unknown): v is FieldDef[] {
  return Array.isArray(v) && v.length > 0 && v.length <= FIELD_LIMITS.maxFields && v.every((f) => f && typeof f.name === "string" && NAME_RE.test(f.name) && TYPES.includes(f.type) && typeof f.required === "boolean");
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate (and normalize) a value against fields. Unknown fields are rejected. */
export function validateAgainstFields(fields: FieldDef[], value: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "Esta colección tiene campos definidos: el valor debe ser un objeto con esos campos." };
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input)) if (!fields.some((f) => f.name === k)) return { ok: false, error: `El campo "${k.slice(0, 40)}" no existe en esta colección.` };
  for (const f of fields) {
    const v = input[f.name];
    if (v === undefined || v === null || v === "") {
      if (f.required) return { ok: false, error: `Falta el campo obligatorio "${f.name}".` };
      continue;
    }
    if (f.type === "texto") {
      if (typeof v !== "string" || v.length > FIELD_LIMITS.maxTextLength) return { ok: false, error: `"${f.name}" debe ser texto de hasta ${FIELD_LIMITS.maxTextLength} caracteres.` };
      out[f.name] = v;
    } else if (f.type === "numero") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n)) return { ok: false, error: `"${f.name}" debe ser un número.` };
      out[f.name] = n;
    } else if (f.type === "booleano") {
      const b = v === true || v === "true" ? true : v === false || v === "false" ? false : null;
      if (b === null) return { ok: false, error: `"${f.name}" debe ser verdadero o falso.` };
      out[f.name] = b;
    } else {
      if (typeof v !== "string" || !validDate(v)) return { ok: false, error: `"${f.name}" debe ser una fecha AAAA-MM-DD válida.` };
      out[f.name] = v;
    }
  }
  return { ok: true, value: out };
}
