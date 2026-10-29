import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
// Optional console-only storage. Install explicitly in an isolated environment;
// never run this DDL automatically as part of an application build.
export const consolePreferences = pgTable(
  "console_preferences",
  {
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    showFailures: boolean("show_failures").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);
export const consoleGrants = pgTable(
  "console_grants",
  {
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    teamIds: jsonb("team_ids").notNull().$type<string[]>(),
    workflowIds: jsonb("workflow_ids").notNull().$type<string[]>(),
    canRun: boolean("can_run").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);
export const consoleAudit = pgTable("console_audit", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  actorId: text("actor_id").notNull(),
  subjectId: text("subject_id").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const consoleWorkflowSettings = pgTable(
  "console_workflow_settings",
  {
    organizationId: text("organization_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    notifyFailure: boolean("notify_failure").notNull().default(true),
    notifyConnection: boolean("notify_connection").notNull().default(true),
    notifyApproval: boolean("notify_approval").notNull().default(true),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.workflowId] })],
);
export const consoleChangeRequests = pgTable("console_change_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  actorId: text("actor_id").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Separate console affiliation and selection never grant builder membership.
export const consoleMemberships=pgTable('console_memberships',{
 organizationId:text('organization_id').notNull(),userId:text('user_id').notNull(),
 enabled:boolean('enabled').notNull().default(true),createdAt:timestamp('created_at').notNull().defaultNow(),
},t=>[primaryKey({columns:[t.organizationId,t.userId]})]);
export const consoleSessions=pgTable('console_sessions',{
 sessionId:text('session_id').primaryKey(),organizationId:text('organization_id').notNull(),updatedAt:timestamp('updated_at').notNull().defaultNow(),
});
export const consoleInvitations=pgTable('console_invitations',{
 id:text('id').primaryKey(),organizationId:text('organization_id').notNull(),email:text('email').notNull(),
 inviterId:text('inviter_id').notNull(),role:text('role').notNull(),teamIds:jsonb('team_ids').notNull().$type<string[]>(),workflowIds:jsonb('workflow_ids').notNull().$type<string[]>(),
 canRun:boolean('can_run').notNull().default(false),status:text('status').notNull().default('pending'),expiresAt:timestamp('expires_at').notNull(),createdAt:timestamp('created_at').notNull().defaultNow(),
});
export const consoleReconnects=pgTable('console_reconnects',{
 id:text('id').primaryKey(),organizationId:text('organization_id').notNull(),integrationId:text('integration_id').notNull(),ownerId:text('owner_id').notNull(),actorId:text('actor_id').notNull(),
 expectedVersion:text('expected_version').notNull(),expiresAt:timestamp('expires_at').notNull(),status:text('status').notNull().default('pending'),
});
export const consoleOutbox=pgTable('console_outbox',{
 id:text('id').primaryKey(),organizationId:text('organization_id').notNull(),recipient:text('recipient').notNull(),kind:text('kind').notNull(),
 dedupeKey:text('dedupe_key').notNull().unique(),status:text('status').notNull().default('dry-run'),attempts:integer('attempts').notNull().default(0),claimedAt:timestamp('claimed_at'),claimId:text('claim_id'),createdAt:timestamp('created_at').notNull().defaultNow(),
});
export const consoleVerification=pgTable('console_verification',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),tokenHash:text('token_hash').notNull(),expiresAt:timestamp('expires_at').notNull(),used:boolean('used').notNull().default(false),
});
export const consoleRateLimits=pgTable('console_rate_limits',{
 key:text('key').primaryKey(),windowStart:timestamp('window_start').notNull(),attempts:integer('attempts').notNull(),
});
