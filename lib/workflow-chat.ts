import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
export type ChatRow = { id: string; role: "user" | "assistant"; content: string; created_at: string };
let ready: Promise<unknown> | null = null;
function ensure() {
  ready ??= db.execute(sql`CREATE TABLE IF NOT EXISTS workflow_chat_messages (id text PRIMARY KEY, workflow_id text NOT NULL, user_id text NOT NULL, role text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
    .then(() => db.execute(sql`CREATE INDEX IF NOT EXISTS workflow_chat_messages_idx ON workflow_chat_messages (user_id, workflow_id, created_at)`))
    .catch(e => { ready = null; throw e; });
  return ready;
}
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export function validWorkflowId(id: unknown): id is string { return typeof id === "string" && ID.test(id); }
export async function history(userId: string, workflowId: string, limit = 40): Promise<ChatRow[]> {
  await ensure();
  const rows = await db.execute(sql`SELECT id, role, content, created_at FROM (SELECT * FROM workflow_chat_messages WHERE user_id=${userId} AND workflow_id=${workflowId} ORDER BY created_at DESC LIMIT ${limit}) t ORDER BY created_at ASC`);
  return [...rows].map(r => ({ id: String(r.id), role: r.role as "user" | "assistant", content: String(r.content), created_at: new Date(r.created_at as string).toISOString() }));
}
export async function append(userId: string, workflowId: string, role: "user" | "assistant", content: string) {
  await ensure();
  await db.execute(sql`INSERT INTO workflow_chat_messages(id,workflow_id,user_id,role,content) VALUES(${randomUUID()},${workflowId},${userId},${role},${content.slice(0, 8000)})`);
}
// Simple abuse cap: the model is free but not unlimited.
export async function recentUserMessages(userId: string): Promise<number> {
  await ensure();
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM workflow_chat_messages WHERE user_id=${userId} AND role='user' AND created_at > now() - interval '1 hour'`);
  return Number(r[0]?.n || 0);
}
