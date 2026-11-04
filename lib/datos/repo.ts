import "server-only";

import { createHash } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DATOS_LIMITS, exactSum, type DatosRecord, type DatosRepo, type IncrementReason, MAX_SAFE, OPS_COLLECTION, type OpIdentity, type IncrementOpts, type TogetherOp, type TogetherOutcome, runTogether } from "./core";
import { dataRecords } from "./schema";

const toRecord = (r: typeof dataRecords.$inferSelect): DatosRecord => ({ collection: r.collection, key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() });
const opRowKey = (opId: string, c: string, key: string) => createHash("sha256").update(`${opId}\u0000${c}\u0000${key}`).digest("hex").slice(0, 40);
// postgres-js returns an array; other drivers (tests) return { rows }.
const rowsOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] })?.rows ?? []));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any; // drizzle db or transaction (same query API)
const getRow = async (x: Exec, o: string, c: string, key: string): Promise<DatosRecord | null> => {
  const [r] = await x.select().from(dataRecords).where(and(eq(dataRecords.organizationId, o), eq(dataRecords.collection, c), eq(dataRecords.key, key))).limit(1);
  return r ? toRecord(r) : null;
};
/**
 * Runs one Datos operation. With an operation identity (the SDK step id) it is protected against replays:
 * under a per-operation lock it first looks for the stored terminal result (applied OR rejected) and returns it
 * unchanged; the same id with another fingerprint is a conflict; otherwise it checks the protected-operations cap,
 * runs the operation and stores its terminal result in the same transaction. No rows are ever deleted.
 */
class SnapshotTooLarge extends Error {}
async function withLedger<T extends { record: DatosRecord | null }>(o: string, c: string, key: string, op: OpIdentity | undefined, run: (x: Exec) => Promise<T>, signal: { conflict: () => any; tooLarge: () => any }): Promise<T & { replayed?: boolean }> {
  try { return await withLedgerTx(o, c, key, op, run, signal); } catch (e) { if (e instanceof SnapshotTooLarge) return signal.tooLarge(); throw e; }
}
async function withLedgerTx<T extends { record: DatosRecord | null }>(o: string, c: string, key: string, op: OpIdentity | undefined, run: (x: Exec) => Promise<T>, signal: { conflict: () => any; tooLarge: () => any }): Promise<T & { replayed?: boolean }> {
  return db.transaction(async (tx) => {
    let rowKey = "";
    if (op) {
      rowKey = opRowKey(op.id, c, key);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`datos-op:${o}:${rowKey}`}))`);
      const seen = await getRow(tx, o, OPS_COLLECTION, rowKey);
      if (seen) {
        const v = seen.value as { fp?: string; r?: object };
        if (v.fp !== op.fp) return signal.conflict();
        return { ...(v.r as object), replayed: true } as T & { replayed?: boolean }; // full stored output, record included: nothing is read from the current data
      }
    }
    const r = await run(tx);
    if (op) {
      // Snapshot of the WHOLE output (record included). If it cannot be stored, the whole transaction (the data write too) rolls back.
      const stored = { fp: op.fp, r, at: new Date().toISOString() };
      if (Buffer.byteLength(JSON.stringify(stored)) > DATOS_LIMITS.maxSnapshotBytes) throw new SnapshotTooLarge();
      await tx.insert(dataRecords).values({ organizationId: o, collection: OPS_COLLECTION, key: rowKey, value: stored as never });
    }
    return r;
  });
}
const scope = (o: string, c: string) => and(eq(dataRecords.organizationId, o), eq(dataRecords.collection, c));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insertIfAbsentInner = async (x: Exec, o: string, c: string, key: string, value: unknown, maxRecords: number): Promise<any> => {

      // The advisory lock serializes concurrent creators so the 5000-record check and the insert cannot interleave.
      await x.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`datos:${o}:${c}`}))`);
      const cur = await getRow(x, o, c, key);
      if (cur) return { status: "exists" as const, record: cur };
      const [n] = await x.select({ n: count() }).from(dataRecords).where(scope(o, c));
      if (Number(n?.n ?? 0) >= maxRecords) return { status: "full" as const, record: null };
      const [row] = await x.insert(dataRecords).values({ organizationId: o, collection: c, key, value: value as never }).returning();
      return { status: "created" as const, record: toRecord(row) };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const compareAndSetInner = async (x: Exec, o: string, c: string, key: string, expected: unknown, next: unknown): Promise<any> => {

      const rows = await x.execute(sql`UPDATE data_records SET value = ${JSON.stringify(next)}::jsonb, updated_at = now()
        WHERE organization_id = ${o} AND collection = ${c} AND key = ${key} AND value = ${JSON.stringify(expected)}::jsonb
        RETURNING collection, key, value, updated_at`);
      const row = rowsOf<{ collection: string; key: string; value: unknown; updated_at: Date | string }>(rows)[0];
      if (row) return { updated: true, record: { collection: row.collection, key: row.key, value: row.value, updatedAt: new Date(row.updated_at).toISOString() } };
      return { updated: false, record: await getRow(x, o, c, key) };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const incrementInner = async (x: Exec, o: string, c: string, key: string, field: string, amount: number, opts: IncrementOpts): Promise<any> => {
    const amt = String(amount);
    const min = opts.min === undefined ? null : String(opts.min);
    const max = opts.max === undefined ? null : String(opts.max);
    const MAXS = String(MAX_SAFE);

      // Lock the record: concurrent adds on it queue here.
      const locked = rowsOf<unknown>(await x.execute(sql`SELECT 1 AS x FROM data_records WHERE organization_id = ${o} AND collection = ${c} AND key = ${key} FOR UPDATE`));
      if (locked.length === 0) return { applied: false, reason: "missing" as IncrementReason, valor: null, record: null };
      // One statement checks and writes. jsonb numbers are exact decimals; text is never cast. The result must
      // survive a round trip through a double (what JS reads back), or nothing is written.
      const rows = await x.execute(sql`UPDATE data_records d
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
      if (row) return { applied: true, valor: ((row.value as Record<string, unknown>)[field] as number) ?? null, record: { collection: row.collection, key: row.key, value: row.value, updatedAt: new Date(row.updated_at).toISOString() } };
      // Nothing changed: classify why from the current record (message only; data was not touched).
      const cur = await getRow(x, o, c, key);
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
      return { applied: false, reason, valor: typeof v?.[field] === "number" ? (v[field] as number) : null, record: cur };
};

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
  async insertIfAbsent(o, c, key, value, maxRecords, op) {
    return withLedger(o, c, key, op, (x) => insertIfAbsentInner(x, o, c, key, value, maxRecords), { conflict: () => ({ status: "conflict" as const, record: null }), tooLarge: () => ({ status: "snapshot_too_large" as const, record: null }) });
  },
  async compareAndSet(o, c, key, expected, next, op) {
    return withLedger(o, c, key, op, (x) => compareAndSetInner(x, o, c, key, expected, next), { conflict: () => ({ updated: false, conflict: true, record: null }), tooLarge: () => ({ updated: false, tooLarge: true, record: null }) });
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
  async applyTogether(o, ops, op) {
    class Rejected extends Error { constructor(readonly outcome: TogetherOutcome) { super("rejected"); } }
    type Row = { collection: string; key: string };
    // The whole batch is ONE ledger entry (one op id, one stored snapshot). Rejection rolls back the batch only (savepoint); the terminal "rechazado" is still stored.
    return withLedger(o, "$together", "batch", op, async (x) => {
      // Lock order, identical for every batch: 1) collection locks (sorted) for creators, 2) row locks (sorted by collection, key). No cycle is possible.
      const cols = [...new Set(ops.filter((p) => p.kind === "saveIfAbsent").map((p) => p.collection))].sort();
      for (const c of cols) await x.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`datos:${o}:${c}`}))`);
      const rows: Row[] = ops.filter((p) => p.kind !== "saveIfAbsent").map((p) => ({ collection: p.collection, key: p.key })).sort((a, b) => (a.collection === b.collection ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.collection < b.collection ? -1 : 1));
      for (const r of rows) await x.execute(sql`SELECT 1 AS x FROM data_records WHERE organization_id = ${o} AND collection = ${r.collection} AND key = ${r.key} FOR UPDATE`);
      let outcome: TogetherOutcome;
      try {
        outcome = await x.transaction(async (sp: Exec) => {
          const res = await runTogether(ops, { insert: (p) => insertIfAbsentInner(sp, o, p.collection, p.key, p.value, DATOS_LIMITS.maxRecordsPerCollection), cas: (p) => compareAndSetInner(sp, o, p.collection, p.key, p.expected, p.value), inc: (p) => incrementInner(sp, o, p.collection, p.key, p.field, p.amount, p.opts) });
          if (res.status !== "applied") throw new Rejected(res);
          return res;
        });
      } catch (e) { if (e instanceof Rejected) outcome = e.outcome; else throw e; }
      return { ...outcome, record: null };
    }, { conflict: () => ({ status: "conflict" as const, record: null }), tooLarge: () => ({ status: "snapshot_too_large" as const, record: null }) });
  },
  async increment(o, c, key, field, amount, opts, op) {
    return withLedger(o, c, key, op, (x) => incrementInner(x, o, c, key, field, amount, opts), { conflict: () => ({ applied: false, reason: "conflict" as IncrementReason, record: null }), tooLarge: () => ({ applied: false, reason: "snapshot_too_large" as IncrementReason, record: null }) });
  },
};
