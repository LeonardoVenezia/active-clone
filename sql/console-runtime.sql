DO $console_migration$
BEGIN
CREATE TABLE console_preferences (organization_id text NOT NULL,user_id text NOT NULL,show_failures boolean NOT NULL DEFAULT true,updated_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,user_id));
CREATE TABLE console_grants (organization_id text NOT NULL,user_id text NOT NULL,role text NOT NULL CHECK(role IN ('admin','manager','operator')),team_ids jsonb NOT NULL,workflow_ids jsonb NOT NULL,can_run boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT true,updated_by text NOT NULL,updated_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,user_id));
CREATE TABLE console_audit (id text PRIMARY KEY,organization_id text NOT NULL,actor_id text NOT NULL,subject_id text NOT NULL,action text NOT NULL,created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE console_workflow_settings (organization_id text NOT NULL,workflow_id text NOT NULL,notify_failure boolean NOT NULL DEFAULT true,notify_connection boolean NOT NULL DEFAULT true,notify_approval boolean NOT NULL DEFAULT true,updated_by text NOT NULL,updated_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,workflow_id));
CREATE TABLE console_change_requests (id text PRIMARY KEY,organization_id text NOT NULL,workflow_id text NOT NULL,actor_id text NOT NULL,description text NOT NULL,status text NOT NULL DEFAULT 'open',created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE console_memberships (organization_id text NOT NULL,user_id text NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,user_id));
CREATE TABLE console_sessions (session_id text PRIMARY KEY,organization_id text NOT NULL,updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE console_invitations (id text PRIMARY KEY,organization_id text NOT NULL,email text NOT NULL,inviter_id text NOT NULL,role text NOT NULL,team_ids jsonb NOT NULL,workflow_ids jsonb NOT NULL,can_run boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'pending',expires_at timestamp NOT NULL,created_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX console_invitations_pending_email ON console_invitations(organization_id,email) WHERE status='pending';
END
$console_migration$;
