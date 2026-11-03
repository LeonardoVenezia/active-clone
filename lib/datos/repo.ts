import "server-only";

import { createHash } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DATOS_LIMITS, exactSum, OPS_COLLECTION, opFingerprint, type DatosRecord, type DatosRepo, type IncrementReason, MAX_SAFE } from "./core";
import { dataRecords } from "./schema";

const toRecord = (r: typeof dataRecords.$inferSelect): DatosRecord => ({ collection: r.collection, key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() });
const opRowKey = (opId: string, c: string, key: string) => createHash("sha256").update(`${opId}\u0000${c}\u0000${key}`).digest("hex").slice(0, 40);
// postgres-js returns an array; other drivers (tests) return { rows }.
const rowsOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] })?.rows ?? []));
const scope = (o: string, c: string) => and(eq(dataRecords.organizationId, o), eq(dataRecords.collection, c));

export const pgDatosRepo: DatosRepo = {
  async put(o, c, key, value) {
    const [row] = await db.insert(dataRecords).values({ organizationId: o, collection: c, key, value: value as never })
      .onConflictDoUpdate({ target: [dataRecords.organizationId, dataRecords.collection, dataRecords.key], set: { value: value as never, updatedAt: new Date() } }).returning();
    return toRecord(row);
  },
  async get(o, c, key) {
    const [row] = await db.select().from(dataRecords).where(and(scope(o, c), eq(dataRecords.key, key))).limit(1);
    return row ? toRecord(row) : null;
  },
  async list(o, c, limit) {
    return (await db.select().from(dataRecords).where(scope(o, c)).orderBy(desc(dataRecords.updatedAt)).limit(limit)).map(toRecord);
  },
  async count(o, c) {
    const [r] = await db.select({ n: count() }).from(dataRecords).where(scope(o, c));
    return Number(r?.n ?? 0);
  },
  async insertIfAbsent(o, c, key, value, maxRecords) {
    // One transaction per collection: the advisory lock serializes concurrent creators so the
    // 5000-record check and the insert cannot interleave. Existing keys never need the lock's count.
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`datos:${o}:${c}`}))`);
      const [cur] = await tx.select().from(dataRecords).where(and(scope(o, c), eq(dataRecords.key, key))).limit(1);
      if (cur) return { status: "exists" as const, record: toRecord(cur) };
      const [n] = await tx.select({ n: count() }).from(dataRecords).where(scope(o, c));
      if (Number(n?.n ?? 0) >= maxRecords) return { status: "full" as const, record: null };
      const [row] = await tx.insert(dataRecords).values({ organizationId: o, collection: c, key, value: value as never }).returning();
      return { status: "created" as const, record: toRecord(row) };
    });
  },
  async compareAndSet(o, c, key, expected, next) {
    const rows = await db.execute(sql`UPDATE data_records SET value = ${JSON.stringify(next)}::jsonb, updated_at = now()
      WHERE organization_id = ${o} AND collection = ${c} AND key = ${key} AND value = ${JSON.stringify(expected)}::jsonb
      RETURNING collection, key, value, updated_at`);
    const row = rowsOf<{ collection: string; key: string; value: unknown; updated_at: Date | string }>(rows)[0];
    if (row) return { updated: true, record: { collection: row.collection, key: row.key, value: row.value, updatedAt: new Date(row.updated_at).toISOString() } };
    return { updated: false, record: await this.get(o, c, key) };
  },
  async putWithQuota(o, c, key, value, maxRecords) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`datos:${o}:${c}`}))`);
      const [cur] = await tx.select().from(dataRecords).where(and(scope(o, c), eq(dataRecords.key, key))).limit(1);
      if (!cur) {
        const [n] = await tx.select({ n: count() }).from(dataRecords).where(scope(o, c));
        if (Number(n?.n ?? 0) >= maxRecords) return { status: "full" as const, record: null };
      }
      const [row] = await tx.insert(dataRecords).values({ organizationId: o, collection: c, key, value: value as never })
        .onConflictDoUpdate({ target: [dataRecords.organizationId, dataRecords.collection, dataRecords.key], set: { value: value as never, updatedAt: new Date() } }).returning();
      return { status: "saved" as const, record: toRecord(row) };
    });
  },
  async increment(o, c, key, field, amount, opts, opId) {
    const amt = String(amount);
    const min = opts.min === undefined ? null : String(opts.min);
    const max = opts.max === undefined ? null : String(opts.max);
    const MAXS = String(MAX_SAFE);
    return db.transaction(async (tx) => {
      // Lock the record: concurrent adds on it queue here, so the ledger read-modify-write below is serialized too.
      const locked = rowsOf<unknown>(await tx.execute(sql`SELECT 1 AS x FROM data_records WHERE organization_id = ${o} AND collection = ${c} AND key = ${key} FOR UPDATE`));
      const getCur = async () => { const [r] = await tx.select().from(dataRecords).where(and(scope(o, c), eq(dataRecords.key, key))).limit(1); return r ? toRecord(r) : null; };
      if (locked.length === 0) return { applied: false, reason: "missing" as IncrementReason, record: null };
      // One durable row per applied operation (no window, no deletion). Checked under the record lock.
      const opRow = opId ? opRowKey(opId, c, key) : "";
      if (opId) {
        const [seen] = await tx.select().from(dataRecords).where(and(eq(dataRecords.organizationId, o), eq(dataRecords.collection, OPS_COLLECTION), eq(dataRecords.key, opRow))).limit(1);
        if (seen) return { applied: false, reason: ((seen.value as { fp?: string }).fp === opFingerprint(field, amount, opts) ? "duplicate" : "conflict") as IncrementReason, record: await getCur() };
      }
      // One statement checks and writes. jsonb numbers are exact decimals; text is never cast. The result must
      // survive a round trip through a double (what JS reads back), or nothing is written.
      const rows = await tx.execute(sql`UPDATE data_records d
        SET value = jsonb_set(d.value, ARRAY[${field}]::text[], to_jsonb(x.nv), true), updated_at = now()
        FROM (SELECT (CASE WHEN jsonb_typeof(value->${field}) = 'number' THEN (value->>${field})::numeric ELSE 0::numeric END) AS b
              FROM data_records WHERE organization_id = ${o} AND collection = ${c} AND key = ${key}) base,
             LATERAL (SELECT base.b + ${amt}::numeric AS nv) x
        WHERE d.organization_id = ${o} AND d.collection = ${c} AND d.key = ${key}
          AND jsonb_typeof(d.value) = 'object'
          AND (jsonb_typeof(d.value->${field}) = 'number' OR (${opts.startAtZero}::boolean AND NOT (d.value ? ${field})))
          AND CASE WHEN abs(base.b) <= ${MAXS}::numeric AND abs(x.nv) <= ${MAXS}::numeric
                   THEN (base.b::float8::text::numeric = base.b AND x.nv::float8::text::numeric = x.nv) ELSE false END
          AND (${min}::numeric IS NULL OR x.nv >= ${min}::numeric)
          AND (${max}::numeric IS NULL OR x.nv <= ${max}::numeric)
          AND octet_length(jsonb_set(d.value, ARRAY[${field}]::text[], to_jsonb(x.nv), true)::text) <= ${DATOS_LIMITS.maxValueBytes}
        RETURNING d.collection, d.key, d.value, d.updated_at`);
      const row = rowsOf<{ collection: string; key: string; value: unknown; updated_at: Date | string }>(rows)[0];
      if (row) {
        if (opId) await tx.insert(dataRecords).values({ organizationId: o, collection: OPS_COLLECTION, key: opRow, value: { at: new Date().toISOString(), fp: opFingerprint(field, amount, opts) } as never });
        return { applied: true, record: { collection: row.collection, key: row.key, value: row.value, updatedAt: new Date(row.updated_at).toISOString() } };
      }
      // Nothing changed: classify why from the current record (message only; data was not touched).
      const cur = await getCur();
      let reason: IncrementReason = "retry";
      const v = cur?.value as Record<string, unknown> | null | undefined;
      if (typeof v !== "object" || v === null || Array.isArray(v)) reason = "not_object";
      else if (!(field in v) && !opts.startAtZero) reason = "field_missing";
      else if (field in v && typeof v[field] !== "number") reason = "not_number";
      else {
        const base = field in v ? (v[field] as number) : 0;
        const res = exactSum(base, amount);
        if (res === null) reason = Math.abs(base + amount) > MAX_SAFE ? "out_of_range" : "precision";
        else if (opts.min !== undefined && res < opts.min) reason = "below_min";
        else if (opts.max !== undefined && res > opts.max) reason = "above_max";
        else reason = JSON.stringify(v).length + 40 > DATOS_LIMITS.maxValueBytes ? "too_large" : "retry";
      }
      return { applied: false, reason, record: cur };
    });
  },
};
