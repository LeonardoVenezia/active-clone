import "server-only";

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DatosRecord, DatosRepo } from "./core";
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
};
