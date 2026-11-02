import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
// Optional storage for the Datos prototype. Migration: drizzle/0014_data_records.sql (additive, IF NOT EXISTS; table stays unused while DATOS_STORAGE_ENABLED is off).
export const dataRecords = pgTable(
  "data_records",
  {
    organizationId: text("organization_id").notNull(),
    collection: text("collection").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.collection, t.key] }), index("data_records_recent").on(t.organizationId, t.collection, t.updatedAt)]
);
