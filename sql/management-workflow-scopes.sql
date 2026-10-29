-- Additive only. No existing workflow associations or variable values are written.
DO $$ BEGIN
  CREATE TABLE management_workflow_scopes (
    workflow_id text PRIMARY KEY,
    organization_id text NOT NULL,
    assigned_by text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
  );
  CREATE INDEX management_workflow_scopes_organization_idx ON management_workflow_scopes (organization_id);
  CREATE TABLE company_variables (
    organization_id text NOT NULL,
    key text NOT NULL,
    secret boolean NOT NULL DEFAULT false,
    ciphertext text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY(organization_id,key)
  );
END $$;
