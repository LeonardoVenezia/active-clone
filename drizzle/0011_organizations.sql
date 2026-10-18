ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "active_organization_id" text;

CREATE TABLE IF NOT EXISTS "organization" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "logo" text,
  "metadata" text,
  "created_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "member" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "invitation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id"),
  "email" text NOT NULL,
  "role" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "inviter_id" text NOT NULL REFERENCES "users"("id")
);
