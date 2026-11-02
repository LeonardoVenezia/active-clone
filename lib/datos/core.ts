/**
 * Datos: generic per-organization record store (prototype, local only).
 *
 * Pure logic with an injected repository so it can be tested offline.
 * The organization id is NEVER read from node config, request body or query
 * string. Callers pass the id they resolved on the server (the executor's
 * organizationId, or the session's verified membership).
 */

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
  maxListLimit: 200,
  defaultListLimit: 50,
} as const;

export type DatosRecord = { collection: string; key: string; value: unknown; updatedAt: string };

export interface DatosRepo {
  put(orgId: string, collection: string, key: string, value: unknown): Promise<DatosRecord>;
  get(orgId: string, collection: string, key: string): Promise<DatosRecord | null>;
  list(orgId: string, collection: string, limit: number): Promise<DatosRecord[]>;
  count(orgId: string, collection: string): Promise<number>;
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
  const exists = await repo.get(org, col, key);
  if (!exists && (await repo.count(org, col)) >= DATOS_LIMITS.maxRecordsPerCollection)
    return { success: false, error: "La colección llegó al máximo de 5000 registros." };
  return { success: true, record: await repo.put(org, col, key, toStore) };
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
  return {
    async put(o, c, key, value) { const r = { collection: c, key, value, updatedAt: new Date(1_700_000_000_000 + ++tick * 1000).toISOString() }; m.set(k(o, c, key), r); return r; },
    async get(o, c, key) { return m.get(k(o, c, key)) ?? null; },
    async list(o, c, limit) { return [...m.entries()].filter(([id]) => { const [oo, cc] = JSON.parse(id); return oo === o && cc === c; }).map(([, r]) => r).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit); },
    async count(o, c) { return [...m.keys()].filter((id) => { const [oo, cc] = JSON.parse(id); return oo === o && cc === c; }).length; },
  };
}
