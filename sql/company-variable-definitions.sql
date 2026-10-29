-- Additive preparation only; no stored values or audience changes.
CREATE TABLE company_variable_definitions (organization_id text NOT NULL,key text NOT NULL,label text NOT NULL,secret boolean NOT NULL,created_by text NOT NULL,created_at timestamp NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,key));
