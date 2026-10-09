CREATE TABLE mail_flows (
 user_id text PRIMARY KEY REFERENCES users(id),
 sheets_account_id text NOT NULL,
 trigger_id text,
 status text NOT NULL DEFAULT 'starting',
 activated_at timestamp,
 next_row integer NOT NULL DEFAULT 2
);
--> statement-breakpoint
CREATE TABLE mail_flow_events (
 user_id text NOT NULL REFERENCES mail_flows(user_id),
 message_id text NOT NULL,
 row_number integer NOT NULL,
 status text NOT NULL,
 error text,
 lease_token text,
 lease_until timestamp,
 updated_at timestamp NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,message_id),
 UNIQUE(user_id,row_number)
);
