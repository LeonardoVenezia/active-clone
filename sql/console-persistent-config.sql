DO $console_config$
BEGIN
CREATE TABLE console_setups (organization_id text PRIMARY KEY,owner_id text NOT NULL,enabled boolean NOT NULL DEFAULT false,updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE console_assignments (workflow_id text PRIMARY KEY,organization_id text NOT NULL,team_id text,updated_by text NOT NULL,updated_at timestamp NOT NULL DEFAULT now());
END
$console_config$;
