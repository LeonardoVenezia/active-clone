CREATE TABLE IF NOT EXISTS "workflow_shares" (
  "id" text PRIMARY KEY NOT NULL,
  "workflow_id" text NOT NULL REFERENCES "workflows"("id"),
  "shared_with_user_id" text NOT NULL REFERENCES "users"("id"),
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_shares_pair_unique" ON "workflow_shares" ("workflow_id", "shared_with_user_id");
