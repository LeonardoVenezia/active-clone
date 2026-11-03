import "server-only";

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DATOS_LIMITS, type DatosRecord, type DatosRepo, type IncrementReason, MAX_SAFE } from "./core";
import { dataRecords } from "./schema";

const toRecord = (r: typeof dataRecords.$inferSelect): DatosRecord => ({ collection: r.collection, key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() });
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
    const row = (rows as unknown as Array<{ collection: string; key: string; value: unknown; updated_at: Date | string }>)[0];
    if (row) return { updated: true, record: { collection: row.collection, key: row.key, value: row.value, updatedAt: new Date(row.updated_at).toISOString() } };
    return { updated: false, record: await this.get(o, c, key) };
  },
  async increment(o, c, key, field, amount, opts) {
    const amt = String(amount);
    const min = opts.min === undefined ? null : String(opts.min);
    const max = opts.max === undefined ? null : String(opts.max);
    // Single statement: the row is locked, checked and updated together. jsonb numbers are exact
    // decimals (numeric); text is never cast. Any failed condition updates nothing.
    const rows = await db.execute(sql`WITH t AS (
        SELECT value, (CASE WHEN jsonb_typeof(value->${field}) = 'number' THEN (value->>${field})::numeric ELSE 0::numeric END) + ${amt}::numeric AS nv
        FROM data_records WHERE organization_id = ${o} AND collection = ${c} AND key = ${key}
          AND jsonb_typeof(value) = 'object'
          AND (jsonb_typeof(value->${field}) = 'number' OR (${opts.startAtZero}::boolean AND NOT (value ? ${field})))
        FOR UPDATE)
      UPDATE data_records d SET value = jsonb_set(d.value, ARRAY[${field}]::text[], to_jsonb(t.nv), true), updated_at = now()
      FROM t
      WHERE d.organization_id = ${o} AND d.collection = ${c} AND d.key = ${key}
        AND abs(t.nv) <= ${String(MAX_SAFE)}::numeric
        AND (${min}::numeric IS NULL OR t.nv >= ${min}::numeric)
        AND (${max}::numeric IS NULL OR t.nv <= ${max}::numeric)
        AND octet_length(jsonb_set(d.value, ARRAY[${field}]::text[], to_jsonb(t.nv), true)::text) <= ${DATOS_LIMITS.maxValueBytes}
      RETURNING d.collection, d.key, d.value, d.updated_at`);
    const row = (rows as unknown as Array<{ collection: string; key: string; value: unknown; updated_at: Date | string }>)[0];
    if (row) return { applied: true, record: { collection: row.collection, key: row.key, value: row.value, updatedAt: new Date(row.updated_at).toISOString() } };
    // Nothing changed: classify why from the current record (message only; data was not touched).
    const cur = await this.get(o, c, key);
    let reason: IncrementReason = "retry";
    if (!cur) reason = "missing";
    else {
      const v = cur.value as Record<string, unknown> | null;
      if (typeof v !== "object" || v === null || Array.isArray(v)) reason = "not_object";
      else if (!(field in v)) reason = opts.startAtZero ? "retry" : "field_missing";
      else if (typeof v[field] !== "number") reason = "not_number";
      else {
        const res = (v[field] as number) + amount;
        if (Math.abs(res) > MAX_SAFE) reason = "out_of_range";
        else if (opts.min !== undefined && res < opts.min) reason = "below_min";
        else if (opts.max !== undefined && res > opts.max) reason = "above_max";
        else reason = "too_large";
      }
      if (reason === "too_large" && !(JSON.stringify(v).length + 30 > DATOS_LIMITS.maxValueBytes)) reason = "retry";
    }
    return { applied: false, reason, record: cur };
  },
};
