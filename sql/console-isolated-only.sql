-- Manual opt-in for an isolated database only. Not part of migration journal/build.
CREATE TABLE IF NOT EXISTS console_preferences (organization_id text NOT NULL,user_id text NOT NULL,show_failures boolean NOT NULL DEFAULT true,updated_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,user_id));
CREATE TABLE IF NOT EXISTS console_grants (organization_id text NOT NULL,user_id text NOT NULL,role text NOT NULL CHECK(role IN ('admin','manager','operator')),team_ids jsonb NOT NULL,workflow_ids jsonb NOT NULL,can_run boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT true,updated_by text NOT NULL,updated_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,user_id));
CREATE TABLE IF NOT EXISTS console_audit (id text PRIMARY KEY,organization_id text NOT NULL,actor_id text NOT NULL,subject_id text NOT NULL,action text NOT NULL,created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS console_workflow_settings (organization_id text NOT NULL,workflow_id text NOT NULL,notify_failure boolean NOT NULL DEFAULT true,notify_connection boolean NOT NULL DEFAULT true,notify_approval boolean NOT NULL DEFAULT true,updated_by text NOT NULL,updated_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,workflow_id));
CREATE TABLE IF NOT EXISTS console_change_requests (id text PRIMARY KEY,organization_id text NOT NULL,workflow_id text NOT NULL,actor_id text NOT NULL,description text NOT NULL,status text NOT NULL DEFAULT 'open',created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS console_memberships (organization_id text NOT NULL,user_id text NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,user_id));
CREATE TABLE IF NOT EXISTS console_sessions (session_id text PRIMARY KEY,organization_id text NOT NULL,updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS console_invitations (id text PRIMARY KEY,organization_id text NOT NULL,email text NOT NULL,inviter_id text NOT NULL,role text NOT NULL,team_ids jsonb NOT NULL,workflow_ids jsonb NOT NULL,can_run boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'pending',expires_at timestamp NOT NULL,created_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS console_invitations_pending_email ON console_invitations(organization_id,email) WHERE status='pending';
CREATE TABLE IF NOT EXISTS console_reconnects (id text PRIMARY KEY,organization_id text NOT NULL,integration_id text NOT NULL,owner_id text NOT NULL,actor_id text NOT NULL,expected_version text NOT NULL,expires_at timestamp NOT NULL,status text NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS console_outbox (id text PRIMARY KEY,organization_id text NOT NULL,recipient text NOT NULL,kind text NOT NULL,dedupe_key text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'dry-run',attempts integer NOT NULL DEFAULT 0,created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS console_verification (id text PRIMARY KEY,user_id text NOT NULL,token_hash text NOT NULL,expires_at timestamp NOT NULL,used boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS console_rate_limits (key text PRIMARY KEY,window_start timestamp NOT NULL,attempts integer NOT NULL);
ALTER TABLE console_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamp;
ALTER TABLE console_outbox ADD COLUMN IF NOT EXISTS claim_id text;
DO $console_config$
BEGIN
CREATE TABLE console_setups (organization_id text PRIMARY KEY,owner_id text NOT NULL,enabled boolean NOT NULL DEFAULT false,updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE console_assignments (workflow_id text PRIMARY KEY,organization_id text NOT NULL,team_id text,updated_by text NOT NULL,updated_at timestamp NOT NULL DEFAULT now());
END
$console_config$;
