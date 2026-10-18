CREATE TABLE IF NOT EXISTS "workflow_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "description" text,
  "source_workflow_id" text,
  "nodes" jsonb NOT NULL,
  "edges" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
