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
  /** Pilot limit: protected operations (rows in $ops) per company. Never deleted automatically. */
  maxProtectedOps: 5000,
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
  insertIfAbsent(orgId: string, collection: string, key: string, value: unknown, maxRecords: number, op?: OpIdentity): Promise<{ status: "created" | "exists" | "full" | "conflict" | "ledger_full"; record: DatosRecord | null; replayed?: boolean }>;
  /** Atomic: replaces the value only if the current value is jsonb-equal to `expected`. */
  compareAndSet(orgId: string, collection: string, key: string, expected: unknown, next: unknown, op?: OpIdentity): Promise<{ updated: boolean; conflict?: boolean; ledgerFull?: boolean; record: DatosRecord | null; replayed?: boolean }>;
  /** Atomic: adds `amount` to a numeric field in one statement. Never converts text. */
  increment(orgId: string, collection: string, key: string, field: string, amount: number, opts: IncrementOpts, op?: OpIdentity): Promise<{ applied: boolean; reason?: IncrementReason; record: DatosRecord | null; valor?: number | null; replayed?: boolean }>;
}

/**
 * Identity of one protected operation: the workflow step id (same on every retry/replay of that step call) and a
 * fingerprint of what it asked for. The first terminal result (applied or rejected) is stored under it and returned
 * unchanged on any replay, before anything is evaluated, even if the data has changed since.
 */
export type OpIdentity = { id: string; fp: string };
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
export type IncrementOpts = { startAtZero: boolean; min?: number; max?: number };
export type IncrementReason = "conflict" | "duplicate" | "precision" | "missing" | "not_object" | "field_missing" | "not_number" | "below_min" | "above_max" | "out_of_range" | "too_large" | "retry" | "ledger_full";
export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
/** Internal collection (like $schemas): one row per applied operation id. Its name contains "$", so no user collection can read, list, write or define fields for it. */
export const OPS_COLLECTION = "$ops";
/** Fingerprint of what an operation asked for; the same operation id with a different fingerprint is a conflict, not a replay. */
export const opFingerprint = (field: string, amount: number, o: IncrementOpts): string => JSON.stringify(["add", field, String(amount), o.startAtZero, o.min ?? null, o.max ?? null]);
export const LEDGER_FULL_MSG = "Se llegó al límite piloto de 5000 operaciones protegidas de esta empresa: no se hizo nada. Esos registros no se borran solos.";
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

function parseValue(value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  let v = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { /* plain text is stored as a string */ }
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

export async function datosSave(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown; value: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ record: DatosRecord }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const parsed = parseValue(args.value);
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
export async function datosSaveIfAbsent(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown; value: unknown; operationId?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ creado: boolean; repetido?: boolean; record: DatosRecord | null }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const parsed = parseValue(args.value);
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
  if (r.status === "ledger_full") return { success: false, error: LEDGER_FULL_MSG };
  if (r.status === "full") return { success: false, error: "La colección llegó al máximo de 5000 registros." };
  return { success: true, creado: r.status === "created", ...(r.replayed ? { repetido: true } : {}), record: r.record };
}

/** Actualizar si coincide: replaces the value only if the current one equals `expected` (jsonb semantic equality: 1 equals 1.0). */
export async function datosUpdateIfMatches(repo: DatosRepo, orgId: unknown, args: { collection: unknown; key: unknown; expected: unknown; value: unknown; operationId?: unknown }, enabled = datosEnabled()): Promise<DatosResult<{ actualizado: boolean; repetido?: boolean; motivo?: string; record: DatosRecord | null }>> {
  const g = guard(orgId, enabled) ?? checkNames(args.collection, args.key);
  if (g) return { success: false, error: g };
  const exp = parseValue(args.expected);
  if (!exp.ok) return { success: false, error: exp.error };
  const parsed = parseValue(args.value);
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
  if (r.ledgerFull) return { success: false, error: LEDGER_FULL_MSG };
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
  if (r.reason === "ledger_full") return { success: false, error: LEDGER_FULL_MSG };
  const why: Record<IncrementReason, string> = {
    conflict: "",
    ledger_full: "",
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
  const ledger = <T extends { record: DatosRecord | null }>(o: string, c: string, key: string, op: OpIdentity | undefined, run: () => T, conflict: any, full: any): any => {
    if (!op) return run();
    const row = k(o, OPS_COLLECTION, sha([op.id, c, key]));
    const seen = m.get(row);
    if (seen) { const v = seen.value as { fp: string; r: object }; return v.fp !== op.fp ? conflict : { ...(v.r as T), record: m.get(k(o, c, key)) ?? null, replayed: true }; }
    if ([...m.keys()].filter((id) => { const [oo, cc] = JSON.parse(id); return oo === o && cc === OPS_COLLECTION; }).length >= DATOS_LIMITS.maxProtectedOps) return full;
    const r = run();
    const { record: _r, ...terminal } = r;
    m.set(row, { collection: OPS_COLLECTION, key: row, value: { fp: op.fp, r: terminal }, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() });
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
      }, { status: "conflict", record: null }, { status: "ledger_full", record: null });
    },
    async compareAndSet(o, c, key, expected, next, op) {
      return ledger(o, c, key, op, () => {
        const cur = m.get(k(o, c, key)); if (!cur) return { updated: false, record: null };
        if (!jsonEqual(cur.value, expected)) return { updated: false, record: cur };
        const r = { collection: c, key, value: next, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() }; m.set(k(o, c, key), r); return { updated: true, record: r };
      }, { updated: false, conflict: true, record: null }, { updated: false, ledgerFull: true, record: null });
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
      }, { applied: false, reason: "conflict" as IncrementReason, record: null }, { applied: false, reason: "ledger_full" as IncrementReason, record: null });
    },
  };
}
