CREATE TABLE IF NOT EXISTS "data_records" (
  "organization_id" text NOT NULL,
  "collection" text NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "data_records_pk" PRIMARY KEY ("organization_id","collection","key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_records_recent" ON "data_records" ("organization_id","collection","updated_at" DESC);
