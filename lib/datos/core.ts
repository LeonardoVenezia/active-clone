/**
 * Datos: generic per-organization record store (prototype, local only).
 *
 * Pure logic with an injected repository so it can be tested offline.
 * The organization id is NEVER read from node config, request body or query
 * string. Callers pass the id they resolved on the server (the executor's
 * organizationId, or the session's verified membership).
 */

import { createHash } from "node:crypto";
import { type FieldDef, isValidFieldList, parseFieldSpec, validateAgainstFields } from "./fields";

/**
 * Internal collection that keeps the optional fields of each collection (key = collection name).
 * Its name contains "$", which no user collection name can contain (they match [a-z0-9_]+), so it can
 * never collide with an existing or future collection, and normal save/read/list reject it.
 */
export const SCHEMA_COLLECTION = "$schemas";

export const DATOS_LIMITS = {
  maxCollectionLength: 40,
  maxKeyLength: 120,
  maxValueBytes: 16_384,
  maxRecordsPerCollection: 5000,
  /** Max size of a stored operation snapshot (output incl. record + fingerprint). */
  maxSnapshotBytes: 40_000,
  /** Max operations in one "aplicar cambios juntos" step (technical bound, not a business rule). */
  maxTogetherOps: 10,
  maxListLimit: 200,
  defaultListLimit: 50,
} as const;

export type DatosRecord = { collection: string; key: string; value: unknown; updatedAt: string };

export interface DatosRepo {
  put(orgId: string, collection: string, key: string, value: unknown): Promise<DatosRecord>;
  get(orgId: string, collection: string, key: string): Promise<DatosRecord | null>;
  list(orgId: string, collection: string, limit: number): Promise<DatosRecord[]>;
  count(orgId: string, collection: string): Promise<number>;
  /** Atomic upsert: the 5000-record check and the write run under the same per-collection lock as insertIfAbsent. */
  putWithQuota(orgId: string, collection: string, key: string, value: unknown, maxRecords: number): Promise<{ status: "saved" | "full"; record: DatosRecord | null }>;
  /** Atomic: creates only if the key is absent (quota checked under a per-collection lock). */
  insertIfAbsent(orgId: string, collection: string, key: string, value: unknown, maxRecords: number, op?: OpIdentity): Promise<{ status: "created" | "exists" | "full" | "conflict" | "snapshot_too_large"; record: DatosRecord | null; replayed?: boolean }>;
  /** Atomic: replaces the value only if the current value is jsonb-equal to `expected`. */
  compareAndSet(orgId: string, collection: string, key: string, expected: unknown, next: unknown, op?: OpIdentity): Promise<{ updated: boolean; conflict?: boolean; tooLarge?: boolean; record: DatosRecord | null; replayed?: boolean }>;
  /** Atomic: adds `amount` to a numeric field in one statement. Never converts text. */
  increment(orgId: string, collection: string, key: string, field: string, amount: number, opts: IncrementOpts, op?: OpIdentity): Promise<{ applied: boolean; reason?: IncrementReason; record: DatosRecord | null; valor?: number | null; replayed?: boolean }>;
  /** Atomic: runs every operation in ONE transaction under ONE operation id, or none. Rejection leaves no partial writes. */
  applyTogether(orgId: string, ops: TogetherOp[], op?: OpIdentity): Promise<TogetherOutcome>;
}

export type TogetherOp =
  | { kind: "saveIfAbsent"; collection: string; key: string; value: unknown }
  | { kind: "updateIfMatches"; collection: string; key: string; expected: unknown; value: unknown }
  | { kind: "add"; collection: string; key: string; field: string; amount: number; opts: IncrementOpts };
export type TogetherOutcome =
  | { status: "applied"; records: (DatosRecord | null)[]; replayed?: boolean }
  | { status: "rejected"; index: number; reason: string; replayed?: boolean }
  | { status: "conflict" }
  | { status: "snapshot_too_large" };
/** Canonical order for locking: by collection, then key (the same order for every caller, so two batches cannot deadlock). */
export const togetherLockOrder = (ops: TogetherOp[]) => [...ops.keys()].sort((a, b) => (ops[a].collection === ops[b].collection ? (ops[a].key < ops[b].key ? -1 : ops[a].key > ops[b].key ? 1 : 0) : ops[a].collection < ops[b].collection ? -1 : 1));
/** Runs the ops in canonical order through the given single-op executors; stops at the first rejection (the caller rolls everything back). */
export async function runTogether(ops: TogetherOp[], h: { insert(o: Extract<TogetherOp, { kind: "saveIfAbsent" }>): Promise<{ status: string; record: DatosRecord | null }>; cas(o: Extract<TogetherOp, { kind: "updateIfMatches" }>): Promise<{ updated: boolean; record: DatosRecord | null }>; inc(o: Extract<TogetherOp, { kind: "add" }>): Promise<{ applied: boolean; reason?: string; record: DatosRecord | null }> }): Promise<TogetherOutcome> {
  const records: (DatosRecord | null)[] = new Array(ops.length).fill(null);
  for (const i of togetherLockOrder(ops)) {
    const o = ops[i];
    if (o.kind === "saveIfAbsent") { const r = await h.insert(o); if (r.status !== "created") return { status: "rejected", index: i, reason: r.status === "full" ? "full" : "exists" }; records[i] = r.record; }
    else if (o.kind === "updateIfMatches") { const r = await h.cas(o); if (!r.updated) return { status: "rejected", index: i, reason: r.record ? "mismatch" : "missing" }; records[i] = r.record; }
    else { const r = await h.inc(o); if (!r.applied) return { status: "rejected", index: i, reason: r.reason ?? "retry" }; records[i] = r.record; }
  }
  return { status: "applied", records };
}

/**
 * Identity of one protected operation: the workflow step id (same on every retry/replay of that step call) and a
 * fingerprint of what it asked for. The first terminal result (applied or rejected) is stored under it and returned
 * unchanged on any replay, before anything is evaluated, even if the data has changed since.
 */
export type OpIdentity = { id: string; fp: string };
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
export type IncrementOpts = { startAtZero: boolean; min?: number; max?: number };
export type IncrementReason = "conflict" | "duplicate" | "precision" | "missing" | "not_object" | "field_missing" | "not_number" | "below_min" | "above_max" | "out_of_range" | "too_large" | "retry" | "snapshot_too_large";
export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
/** Internal collection (like $schemas): one row per applied operation id. Its name contains "$", so no user collection can read, list, write or define fields for it. */
export const OPS_COLLECTION = "$ops";
/** Fingerprint of what an operation asked for; the same operation id with a different fingerprint is a conflict, not a replay. */
export const opFingerprint = (field: string, amount: number, o: IncrementOpts): string => JSON.stringify(["add", field, String(amount), o.startAtZero, o.min ?? null, o.max ?? null]);
const SNAP_MSG = "El resultado es demasiado grande para registrarlo de forma protegida: no se hizo nada.";
const CONFLICT_MSG = "Ya se ejecutó esta misma operación con datos distintos: no se hizo nada.";

/** Decimal parts of a finite number: its shortest JS representation as scaled BigInt. */
function toDec(n: number): { i: bigint; s: number } {
  const str = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(str);
  if (!m) throw new Error("bad number");
  let digits = m[2] + (m[3] ?? ""), scale = (m[3] ?? "").length - Number(m[4] ?? 0);
  if (scale < 0) { digits += "0".repeat(-scale); scale = 0; }
  return { i: BigInt(m[1] + digits), s: scale };
}
/**
 * Exact decimal sum of two JS numbers (0.1 + 0.2 = 0.3). Returns null when the exact result is not the
 * shortest representation of a JS number (it would lose digits when read back as a double), or is beyond ±MAX_SAFE_INTEGER.
 */
export function exactSum(a: number, b: number): number | null {
  const x = toDec(a), y = toDec(b), sc = Math.max(x.s, y.s);
  const canon = (i: bigint, s: number) => { while (s > 0 && i % BigInt(10) === BigInt(0)) { i /= BigInt(10); s--; } return `${i}e${-s}`; };
  const t = x.i * BigInt(10) ** BigInt(sc - x.s) + y.i * BigInt(10) ** BigInt(sc - y.s);
  const n = Number(`${t}e${-sc}`);
  if (!Number.isFinite(n) || Math.abs(n) > MAX_SAFE) return null;
  const back = toDec(n);
  return canon(back.i, back.s) === canon(t, sc) ? n : null;
}

export type DatosResult<T> = ({ success: true } & T) | { success: false; error: string };

const COLLECTION_RE = /^[a-z0-9_]+$/;
const KEY_RE = /^[A-Za-z0-9_.:@-]+$/;

export function datosEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DATOS_STORAGE_ENABLED === "true";
}

function guard(orgId: unknown, enabled: boolean): string | null {
  if (!enabled) return "Datos no está habilitado.";
  if (typeof orgId !== "string" || orgId.trim() === "") return "Este workflow no pertenece a una empresa: Datos no está disponible.";
  return null;
}

function checkNames(collection: unknown, key?: unknown): string | null {
  if (typeof collection !== "string" || collection.length === 0 || collection.length > DATOS_LIMITS.maxCollectionLength || !COLLECTION_RE.test(collection))
    return "El nombre de la colección debe usar solo minúsculas, números y _ (máximo 40).";
  if (key !== undefined && (typeof key !== "string" || key.length === 0 || key.length > DATOS_LIMITS.maxKeyLength || !KEY_RE.test(key)))
    return "La clave debe usar letras, números y . _ : @ - (máximo 120).";
  return null;
}

// strict = the step declared valueFormat "json" (the builder serializes objects it generates as JSON text): text that does not parse is refused
// instead of being stored as plain text, because a reference value (null, a quote, a newline) broke the document. Without the flag the legacy
// behaviour is unchanged: text that does not parse is stored as text.
function parseValue(value: unknown, strict = false): { ok: true; value: unknown } | { ok: false; error: string } {
  let v = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { if (strict) return { ok: false, error: "El valor debía ser JSON válido pero un dato lo rompió (por ejemplo vacío o con comillas): no se guardó nada." }; /* plain text is stored as a string */ }
  }
  let size = 0;
  try { size = new TextEncoder().encode(JSON.stringify(v ?? null)).length; } catch { return { ok: false, error: "El valor no se puede guardar como JSON." }; }
  if (size > DATOS_LIMITS.maxValueBytes) return { ok: false, error: "El valor supera el máximo de 16 KB." };
  return { ok: true, value: v ?? null };
}

/** Fields defined for a collection, or null (free-form collection, as before). */
export async function datosGetFields(repo: DatosRepo, orgId: string, collection: string): Promise<FieldDef[] | null> {
  const rec = await repo.get(orgId, SCHEMA_COLLECTION, collection);
  const f = (rec?.value as { fields?: unknown } | undefined)?.fields;
  return isValidFieldList(f) ? f : null;
}

/** Define (or replace) the optional fields of a collection. Existing records are NOT changed or deleted. */
export async function datosDefineFields(repo: DatosRepo, orgId: unknown, args: { collection: unknown; fields: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ collection: string; fields: FieldDef[] }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection);
  if (g) return { success: false, error: g };
  const parsed = parseFieldSpec(args.fields);
  if (!parsed.ok) return { success: false, error: parsed.error };
  await repo.put(orgId as string, SCHEMA_COLLECTION, args.collection as string, { fields: parsed.fields });
  return { success: true, collection: args.collection as string, fields: parsed.fields };
}

export async function datosSave(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown; value: unknown; valueFormat?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ record: DatosRecord }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const parsed = parseValue(args.value, args.valueFormat === "json");
  if (!parsed.ok) return { success: false, error: parsed.error };
  const org = orgId as string, col = args.collection as string, key = args.key as string;
  let toStore = parsed.value;
  const fields = await datosGetFields(repo, org, col);
  if (fields) {
    const v = validateAgainstFields(fields, toStore);
    if (!v.ok) return { success: false, error: v.error };
    toStore = v.value;
  }
  const w = await repo.putWithQuota(org, col, key, toStore, DATOS_LIMITS.maxRecordsPerCollection);
  if (w.status === "full" || !w.record) return { success: false, error: "La colección llegó al máximo de 5000 registros." };
  return { success: true, record: w.record };
}

function parseAmount(v: unknown, label: string): { ok: true; n: number } | { ok: false; error: string } {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return { ok: false, error: `${label} debe ser un número.` };
  if (Math.abs(n) > MAX_SAFE) return { ok: false, error: `${label} es demasiado grande (máximo ${MAX_SAFE}).` };
  return { ok: true, n };
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(b)) {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => k in (b as object) && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}
export { jsonEqual };

/** Guardar si no existe: creates only when the key is absent; otherwise returns the existing record untouched. */
export async function datosSaveIfAbsent(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown; value: unknown; valueFormat?: unknown; operationId?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ creado: boolean; repetido?: boolean; record: DatosRecord | null }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const parsed = parseValue(args.value, args.valueFormat === "json");
  if (!parsed.ok) return { success: false, error: parsed.error };
  const org = orgId as string, col = args.collection as string, key = args.key as string;
  let toStore = parsed.value;
  const fields = await datosGetFields(repo, org, col);
  if (fields) {
    const v = validateAgainstFields(fields, toStore);
    if (!v.ok) return { success: false, error: v.error };
    toStore = v.value;
  }
  const opId = typeof args.operationId === "string" && args.operationId.length > 0 ? args.operationId : undefined;
  const r = await repo.insertIfAbsent(org, col, key, toStore, DATOS_LIMITS.maxRecordsPerCollection, opId ? { id: opId, fp: sha(["saveIfAbsent", toStore]) } : undefined);
  if (r.status === "conflict") return { success: false, error: CONFLICT_MSG };
  if (r.status === "snapshot_too_large") return { success: false, error: SNAP_MSG };
  if (r.status === "full") return { success: false, error: "La colección llegó al máximo de 5000 registros." };
  return { success: true, creado: r.status === "created", ...(r.replayed ? { repetido: true } : {}), record: r.record };
}

/** Actualizar si coincide: replaces the value only if the current one equals `expected` (jsonb semantic equality: 1 equals 1.0). */
export async function datosUpdateIfMatches(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown; expected: unknown; value: unknown; valueFormat?: unknown; operationId?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ actualizado: boolean; repetido?: boolean; motivo?: string; record: DatosRecord | null }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const exp = parseValue(args.expected, args.valueFormat === "json");
  if (!exp.ok) return { success: false, error: exp.error };
  const parsed = parseValue(args.value, args.valueFormat === "json");
  if (!parsed.ok) return { success: false, error: parsed.error };
  const org = orgId as string, col = args.collection as string, key = args.key as string;
  let toStore = parsed.value;
  const fields = await datosGetFields(repo, org, col);
  if (fields) {
    const v = validateAgainstFields(fields, toStore);
    if (!v.ok) return { success: false, error: v.error };
    toStore = v.value;
  }
  const opId = typeof args.operationId === "string" && args.operationId.length > 0 ? args.operationId : undefined;
  const r = await repo.compareAndSet(org, col, key, exp.value, toStore, opId ? { id: opId, fp: sha(["updateIfMatches", exp.value, toStore]) } : undefined);
  if (r.conflict) return { success: false, error: CONFLICT_MSG };
  if (r.tooLarge) return { success: false, error: SNAP_MSG };
  if (r.updated) return { success: true, actualizado: true, ...(r.replayed ? { repetido: true } : {}), record: r.record };
  return { success: true, actualizado: false, ...(r.replayed ? { repetido: true } : {}), motivo: r.record ? "El valor actual es distinto del esperado: no se cambió nada." : "El dato no existe: no se cambió nada.", record: r.record };
}

/** Sumar: adds an amount to a numeric field of a single record, atomically. */
export async function datosAdd(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown; field: unknown; amount: unknown; startAtZero?: unknown; min?: unknown; max?: unknown; operationId?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ aplicado: boolean; repetido?: boolean; motivo?: string; valor: number | null; record: DatosRecord | null }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const field = args.field;
  if (typeof field !== "string" || !/^[A-Za-z0-9_]{1,40}$/.test(field)) return { success: false, error: "El campo debe usar letras, números y _ (máximo 40)." };
  const amt = parseAmount(args.amount, "La cantidad a sumar");
  if (!amt.ok) return { success: false, error: amt.error };
  const opts: IncrementOpts = { startAtZero: args.startAtZero === true || args.startAtZero === "true" };
  for (const k of ["min", "max"] as const) {
    const raw = args[k];
    if (raw === undefined || raw === null || raw === "") continue;
    const p = parseAmount(raw, k === "min" ? "El mínimo" : "El máximo");
    if (!p.ok) return { success: false, error: p.error };
    opts[k] = p.n;
  }
  if (opts.min !== undefined && opts.max !== undefined && opts.min > opts.max) return { success: false, error: "El mínimo no puede ser mayor que el máximo." };
  const org = orgId as string, col = args.collection as string, key = args.key as string;
  const fields = await datosGetFields(repo, org, col);
  if (fields) {
    const def = fields.find((f) => f.name === field);
    if (!def || def.type !== "numero") return { success: false, error: `"${field}" no es un campo numérico definido en esta colección.` };
  }
  const opId = typeof args.operationId === "string" && args.operationId.length > 0 ? args.operationId : undefined;
  const r = await repo.increment(org, col, key, field, amt.n, opts, opId ? { id: opId, fp: opFingerprint(field, amt.n, opts) } : undefined);
  const valor = r.replayed ? (r.valor ?? null) : r.record && typeof (r.record.value as Record<string, unknown> | null)?.[field] === "number" ? ((r.record.value as Record<string, unknown>)[field] as number) : null;
  if (r.applied) return { success: true, aplicado: true, ...(r.replayed ? { repetido: true } : {}), valor, record: r.record };
  if (r.reason === "conflict") return { success: false, error: CONFLICT_MSG };
  if (r.reason === "snapshot_too_large") return { success: false, error: SNAP_MSG };
  const why: Record<IncrementReason, string> = {
    conflict: "",
    snapshot_too_large: "",
    duplicate: "Esta operación ya se aplicó antes (reintento o reentrega): no se sumó otra vez.",
    precision: "El resultado no se puede guardar sin perder precisión decimal: no se sumó nada.",
    missing: "El dato no existe: no se sumó nada.",
    not_object: "El dato no es un objeto con campos: no se sumó nada.",
    field_missing: `El campo "${field}" no existe en el dato (activá "Si no existe, empezar en 0"): no se sumó nada.`,
    not_number: `El campo "${field}" no es un número (no se convierte texto): no se sumó nada.`,
    below_min: "El resultado quedaría por debajo del mínimo: no se sumó nada.",
    above_max: "El resultado quedaría por encima del máximo: no se sumó nada.",
    out_of_range: `El resultado supera el rango seguro (±${MAX_SAFE}): no se sumó nada.`,
    too_large: "El resultado supera el máximo de 16 KB: no se sumó nada.",
    retry: "No se pudo aplicar: hubo un cambio simultáneo o el dato guardado tiene más decimales de los que se pueden sumar sin perder precisión. No se sumó nada.",
  };
  return { success: true, aplicado: false, ...(r.replayed || r.reason === "duplicate" ? { repetido: true } : {}), motivo: why[r.reason ?? "retry"], valor, record: r.record };
}

const TOGETHER_WHY: Record<string, string> = {
  exists: "la clave ya existe",
  full: "la colección llegó al máximo de 5000 registros",
  mismatch: "el valor actual es distinto del esperado",
  missing: "el dato no existe",
  precision: "el resultado no se puede guardar sin perder precisión decimal",
  not_object: "el dato no es un objeto con campos",
  field_missing: "el campo no existe en el dato",
  not_number: "el campo no es un número",
  below_min: "el resultado quedaría por debajo del mínimo",
  above_max: "el resultado quedaría por encima del máximo",
  out_of_range: `el resultado supera el rango seguro (±${MAX_SAFE})`,
  too_large: "el resultado supera el máximo de 16 KB",
  retry: "hubo un cambio simultáneo o el dato tiene demasiados decimales",
};

/**
 * Aplicar cambios juntos: a short list of Guardar-si-no-existe / Actualizar-si-coincide / Sumar operations that
 * are applied all together or not at all, under ONE operation id (replay returns the stored result of the whole list).
 */
export async function datosApplyTogether(repo: DatosRepo, orgId: unknown, args: { operations: unknown; operationId?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ estado: "aplicado" | "rechazado"; repetido?: boolean; motivo?: string; operacion?: number; records?: (DatosRecord | null)[] }>> {
  const g = guard(orgId, enabled);
  if (g) return { success: false, error: g };
  let list = args.operations;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { return { success: false, error: "La lista de cambios no es un JSON válido." }; } }
  if (!Array.isArray(list) || list.length === 0) return { success: false, error: "Indicá al menos un cambio." };
  if (list.length > DATOS_LIMITS.maxTogetherOps) return { success: false, error: `Se pueden aplicar hasta ${DATOS_LIMITS.maxTogetherOps} cambios juntos.` };
  const org = orgId as string;
  const ops: TogetherOp[] = [];
  const seen = new Set<string>();
  const fieldsCache = new Map<string, FieldDef[] | null>();
  for (let i = 0; i < list.length; i++) {
    const it = list[i] as Record<string, unknown> | null;
    const at = `Cambio ${i + 1}: `;
    if (!it || typeof it !== "object" || Array.isArray(it)) return { success: false, error: `${at}formato inválido.` };
    const bad = checkNames(it.collection, it.key);
    if (bad) return { success: false, error: at + bad };
    const col = it.collection as string, key = it.key as string;
    const id = JSON.stringify([col, key]);
    if (seen.has(id)) return { success: false, error: `${at}la misma colección y clave aparece dos veces en la lista.` };
    seen.add(id);
    if (!fieldsCache.has(col)) fieldsCache.set(col, await datosGetFields(repo, org, col));
    const fields = fieldsCache.get(col) ?? null;
    if (it.operation === "saveIfAbsent" || it.operation === "updateIfMatches") {
      const parsed = parseValue(it.value);
      if (!parsed.ok) return { success: false, error: at + parsed.error };
      let toStore = parsed.value;
      if (fields) { const v = validateAgainstFields(fields, toStore); if (!v.ok) return { success: false, error: at + v.error }; toStore = v.value; }
      if (it.operation === "saveIfAbsent") ops.push({ kind: "saveIfAbsent", collection: col, key, value: toStore });
      else {
        const exp = parseValue(it.expected);
        if (!exp.ok) return { success: false, error: at + exp.error };
        ops.push({ kind: "updateIfMatches", collection: col, key, expected: exp.value, value: toStore });
      }
    } else if (it.operation === "add") {
      const field = it.field;
      if (typeof field !== "string" || !/^[A-Za-z0-9_]{1,40}$/.test(field)) return { success: false, error: `${at}el campo debe usar letras, números y _ (máximo 40).` };
      const amt = parseAmount(it.amount, "La cantidad a sumar");
      if (!amt.ok) return { success: false, error: at + amt.error };
      const opts: IncrementOpts = { startAtZero: it.startAtZero === true || it.startAtZero === "true" };
      for (const k of ["min", "max"] as const) {
        const raw = it[k];
        if (raw === undefined || raw === null || raw === "") continue;
        const p = parseAmount(raw, k === "min" ? "El mínimo" : "El máximo");
        if (!p.ok) return { success: false, error: at + p.error };
        opts[k] = p.n;
      }
      if (opts.min !== undefined && opts.max !== undefined && opts.min > opts.max) return { success: false, error: `${at}el mínimo no puede ser mayor que el máximo.` };
      if (fields) { const def = fields.find((f) => f.name === field); if (!def || def.type !== "numero") return { success: false, error: `${at}"${field}" no es un campo numérico definido en esta colección.` }; }
      ops.push({ kind: "add", collection: col, key, field, amount: amt.n, opts });
    } else return { success: false, error: `${at}elegí guardar si no existe, actualizar si coincide o sumar.` };
  }
  const opId = typeof args.operationId === "string" && args.operationId.length > 0 ? args.operationId : undefined;
  const r = await repo.applyTogether(org, ops, opId ? { id: opId, fp: sha(["together", ops]) } : undefined);
  if (r.status === "conflict") return { success: false, error: CONFLICT_MSG };
  if (r.status === "snapshot_too_large") return { success: false, error: SNAP_MSG };
  if (r.status === "applied") return { success: true, estado: "aplicado", ...(r.replayed ? { repetido: true } : {}), records: r.records };
  const o = ops[r.index];
  return { success: true, estado: "rechazado", ...(r.replayed ? { repetido: true } : {}), operacion: r.index + 1, motivo: `Cambio ${r.index + 1} (${o.collection} / ${o.key}): ${TOGETHER_WHY[r.reason] ?? r.reason}. No se aplicó ningún cambio.` };
}

export async function datosRead(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ found: boolean; record: DatosRecord | null }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const record = await repo.get(orgId as string, args.collection as string, args.key as string);
  return { success: true, found: !!record, record };
}

export async function datosList(repo: DatosRepo, orgId: unknown, args: { collection: unknown; limit?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ records: DatosRecord[]; count: number }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection);
  if (g) return { success: false, error: g };
  const n = Number(args.limit);
  const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, DATOS_LIMITS.maxListLimit) : DATOS_LIMITS.defaultListLimit;
  const records = await repo.list(orgId as string, args.collection as string, limit);
  return { success: true, records, count: records.length };
}

/** In-memory repository for tests and local prototyping. */
export function memoryRepo(): DatosRepo {
  const m = new Map<string, DatosRecord>();
  const k = (o: string, c: string, key: string) => JSON.stringify([o, c, key]);
  let tick = 0;
  // Same contract as the SQL repo: stored terminal result first, then cap, then run + store.
  const ledger = <T extends { record: DatosRecord | null }>(o: string, c: string, key: string, op: OpIdentity | undefined, run: () => T, conflict: any, tooLarge: any): any => {
    if (!op) return run();
    const row = k(o, OPS_COLLECTION, sha([op.id, c, key]));
    const seen = m.get(row);
    if (seen) { const v = seen.value as { fp: string; r: object }; return v.fp !== op.fp ? conflict : { ...(v.r as T), replayed: true }; }
    const rk = k(o, c, key), prev = m.get(rk);
    const r = run();
    const stored = { fp: op.fp, r };
    if (new TextEncoder().encode(JSON.stringify(stored)).length > DATOS_LIMITS.maxSnapshotBytes) { if (prev) m.set(rk, prev); else m.delete(rk); return tooLarge; } // roll back the data write too
    m.set(row, { collection: OPS_COLLECTION, key: row, value: stored, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() });
    return r;
  };
  return {
    async put(o, c, key, value) { const r = { collection: c, key, value, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() }; m.set(k(o, c, key), r); return r; },
    async get(o, c, key) { return m.get(k(o, c, key)) ?? null; },
    async list(o, c, limit) { return [...m.entries()].filter(([id]) => { const [oo, cc] = JSON.parse(id); return oo === o && cc === c; }).map(([, r]) => r).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit); },
    async count(o, c) { return [...m.keys()].filter((id) => { const [oo, cc] = JSON.parse(id); return oo === o && cc === c; }).length; },
    async putWithQuota(o, c, key, value, max) {
      if (!m.has(k(o, c, key)) && [...m.keys()].filter((id) => { const [oo, cc] = JSON.parse(id); return oo === o && cc === c; }).length >= max) return { status: "full", record: null };
      const r = { collection: c, key, value, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() }; m.set(k(o, c, key), r); return { status: "saved", record: r };
    },
    async insertIfAbsent(o, c, key, value, max, op) {
      return ledger(o, c, key, op, () => {
        const cur = m.get(k(o, c, key)); if (cur) return { status: "exists", record: cur };
        if ([...m.keys()].filter((id) => { const [oo, cc] = JSON.parse(id); return oo === o && cc === c; }).length >= max) return { status: "full", record: null };
        const r = { collection: c, key, value, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() }; m.set(k(o, c, key), r); return { status: "created", record: r };
      }, { status: "conflict", record: null }, { status: "snapshot_too_large", record: null });
    },
    async compareAndSet(o, c, key, expected, next, op) {
      return ledger(o, c, key, op, () => {
        const cur = m.get(k(o, c, key)); if (!cur) return { updated: false, record: null };
        if (!jsonEqual(cur.value, expected)) return { updated: false, record: cur };
        const r = { collection: c, key, value: next, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() }; m.set(k(o, c, key), r); return { updated: true, record: r };
      }, { updated: false, conflict: true, record: null }, { updated: false, tooLarge: true, record: null });
    },
    async increment(o, c, key, field, amount, opts, op) {
      return ledger(o, c, key, op, () => {
        const cur = m.get(k(o, c, key)); if (!cur) return { applied: false, reason: "missing" as IncrementReason, valor: null, record: null };
        const v = cur.value as Record<string, unknown> | null;
        if (typeof v !== "object" || v === null || Array.isArray(v)) return { applied: false, reason: "not_object" as IncrementReason, valor: typeof v?.[field] === "number" ? (v[field] as number) : null, record: cur };
        let base: number;
        if (!(field in v)) { if (!opts.startAtZero) return { applied: false, reason: "field_missing" as IncrementReason, record: cur }; base = 0; }
        else if (typeof v[field] !== "number") return { applied: false, reason: "not_number" as IncrementReason, valor: typeof v?.[field] === "number" ? (v[field] as number) : null, record: cur };
        else base = v[field] as number;
        const res = exactSum(base, amount);
        if (res === null) return { applied: false, reason: (Math.abs(base + amount) > MAX_SAFE ? "out_of_range" : "precision") as IncrementReason, valor: typeof v?.[field] === "number" ? (v[field] as number) : null, record: cur };
        if (opts.min !== undefined && res < opts.min) return { applied: false, reason: "below_min" as IncrementReason, valor: typeof v?.[field] === "number" ? (v[field] as number) : null, record: cur };
        if (opts.max !== undefined && res > opts.max) return { applied: false, reason: "above_max" as IncrementReason, valor: typeof v?.[field] === "number" ? (v[field] as number) : null, record: cur };
        const next = { ...v, [field]: res };
        if (new TextEncoder().encode(JSON.stringify(next)).length > DATOS_LIMITS.maxValueBytes) return { applied: false, reason: "too_large" as IncrementReason, valor: typeof v?.[field] === "number" ? (v[field] as number) : null, record: cur };
        const r = { collection: c, key, value: next, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() }; m.set(k(o, c, key), r);
        return { applied: true, valor: res, record: r };
      }, { applied: false, reason: "conflict" as IncrementReason, record: null }, { applied: false, reason: "snapshot_too_large" as IncrementReason, record: null });
    },
    async applyTogether(o, ops, op) {
      const self = this as DatosRepo;
      const row = op ? k(o, OPS_COLLECTION, sha([op.id, "$together", "batch"])) : "";
      if (op) { const seen = m.get(row); if (seen) { const v = seen.value as { fp: string; r: object }; return v.fp !== op.fp ? { status: "conflict" } : ({ ...(v.r as TogetherOutcome), replayed: true } as TogetherOutcome); } }
      const backup = new Map(m);
      const r = await runTogether(ops, { insert: (x) => self.insertIfAbsent(o, x.collection, x.key, x.value, DATOS_LIMITS.maxRecordsPerCollection), cas: (x) => self.compareAndSet(o, x.collection, x.key, x.expected, x.value), inc: (x) => self.increment(o, x.collection, x.key, x.field, x.amount, x.opts) });
      const rollback = () => { m.clear(); for (const [a, b] of backup) m.set(a, b); };
      if (r.status === "rejected") rollback();
      if (op) {
        const stored = { fp: op.fp, r };
        if (new TextEncoder().encode(JSON.stringify(stored)).length > DATOS_LIMITS.maxSnapshotBytes) { rollback(); return { status: "snapshot_too_large" }; }
        m.set(row, { collection: OPS_COLLECTION, key: row, value: stored, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() });
      }
      return r;
    },
  };
}
