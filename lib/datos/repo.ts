import "server-only";

import { createHash } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DATOS_LIMITS, exactSum, OPS_COLLECTION, OPS_WINDOW, type DatosRecord, type DatosRepo, type IncrementReason, MAX_SAFE } from "./core";
import { dataRecords } from "./schema";

const toRecord = (r: typeof dataRecords.$inferSelect): DatosRecord => ({ collection: r.collection, key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() });
const ledgerKey = (c: string, key: string) => createHash("sha256").update(`${c}\u0000${key}`).digest("hex").slice(0, 40);
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
      const locked = (await tx.execute(sql`SELECT 1 AS x FROM data_records WHERE organization_id = ${o} AND collection = ${c} AND key = ${key} FOR UPDATE`)) as unknown as unknown[];
      const getCur = async () => { const [r] = await tx.select().from(dataRecords).where(and(scope(o, c), eq(dataRecords.key, key))).limit(1); return r ? toRecord(r) : null; };
      if (locked.length === 0) return { applied: false, reason: "missing" as IncrementReason, record: null };
      const opHash = opId ? createHash("sha256").update(opId).digest("hex").slice(0, 24) : "";
      let ids: string[] = [];
      if (opId) {
        const [led] = await tx.select().from(dataRecords).where(and(eq(dataRecords.organizationId, o), eq(dataRecords.collection, OPS_COLLECTION), eq(dataRecords.key, ledgerKey(c, key)))).limit(1);
        ids = ((led?.value as { ids?: string[] } | undefined)?.ids ?? []).filter((x) => typeof x === "string");
        if (ids.includes(opHash)) return { applied: false, reason: "duplicate" as IncrementReason, record: await getCur() };
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
      const row = (rows as unknown as Array<{ collection: string; key: string; value: unknown; updated_at: Date | string }>)[0];
      if (row) {
        if (opId) {
          const next = { ids: [...ids, opHash].slice(-OPS_WINDOW) };
          await tx.insert(dataRecords).values({ organizationId: o, collection: OPS_COLLECTION, key: ledgerKey(c, key), value: next as never })
            .onConflictDoUpdate({ target: [dataRecords.organizationId, dataRecords.collection, dataRecords.key], set: { value: next as never, updatedAt: new Date() } });
        }
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
