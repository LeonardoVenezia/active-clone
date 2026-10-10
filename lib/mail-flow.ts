import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerFor } from "@/lib/connectors/registry";
import { presetFor } from "@/lib/connectors/presets";
import type { NormalizedEvent } from "@/lib/connectors/core/types";
export const SHEET_ID = "1DYNb-dD3k1vJOkJ20eVmJbTxcjtf523UAO--3pWtDjg";
export const SHEET_URL = "https://docs.google.com/spreadsheets/d/1DYNb-dD3k1vJOkJ20eVmJbTxcjtf523UAO--3pWtDjg/edit?authuser=leovenezia%40outlook.com.ar";
const OWNER = "eSAgtpycnNp3JewTMni591wPxlMj6yJI";
const OUTLOOK = "ca_yCkXFi2Yv9mw";
type Obj = Record<string, any>;
export function safeFlowError(e: unknown) {
  const message = e instanceof Error ? e.message : "Flow request failed.";
  if (/failed query|params:|postgres|sql|relation .*exist|column .*exist|database|connect econn|socket/i.test(message)) return "Flow storage operation failed. No completed activation was confirmed. Refresh status before retrying; if it persists, contact support.";
  return message.slice(0,700);
}
export function requireOwner(id: string) { if (id !== OWNER) throw new Error("This flow is private to its owner."); }
type Toolkit = "outlook" | "googlesheets";
// Every provider call goes through the app's connector interface. No vendor types or API shapes here.
async function requireConn(toolkit: Toolkit, id: string) {
  const preset = presetFor(toolkit)!;
  const v = await providerFor(toolkit).verify({ userId: OWNER, connectionId: id, preset });
  if (!v.ok) throw new Error(v.checked
    ? `The granted permissions for this ${toolkit === "outlook" ? "Outlook" : "Google Sheets"} connection are not what this flow needs. ${preset.consentHint} Then connect again and activate the new connection. The existing connection was not revoked.`
    : "The provider did not report which permissions were granted. Connect again and activate the new connection.");
}
async function run(toolkit: Toolkit, id: string, capability: string, input: Obj): Promise<Obj> {
  const r = await providerFor(toolkit).execute<Obj>({ userId: OWNER, connectionId: id, capability, input });
  if (!r.ok) throw new Error(`${capability} failed. No automatic append retry.`);
  return r.data;
}
export async function connectSheets(id: string, callback: string) {
  requireOwner(id);
  return providerFor("googlesheets").beginConnect({ userId: OWNER, preset: presetFor("googlesheets")!, callbackUrl: callback });
}
export async function flowStatus(id: string) {
  requireOwner(id);
  const flows = await db.execute(sql`SELECT status, trigger_id, sheets_account_id, activated_at, next_row FROM mail_flows WHERE user_id=${OWNER}`);
  const runs = await db.execute(sql`SELECT message_id, row_number, status, error, updated_at FROM mail_flow_events WHERE user_id=${OWNER} ORDER BY updated_at DESC LIMIT 20`);
  const conns = await providerFor("googlesheets").listConnections({ userId: OWNER, preset: presetFor("googlesheets")! });
  return { flow: flows[0] || null, runs: [...runs].map(r => ({...r,error:r.error ? safeFlowError(new Error(String(r.error))) : null})), accounts: conns.map(c => ({ id: c.id, status: c.status === "active" ? "ACTIVE" : c.status.toUpperCase() })), sheetUrl: SHEET_URL };
}
export async function activateFlow(id: string, sheetAccount: string) {
  requireOwner(id); await requireConn("outlook", OUTLOOK); await requireConn("googlesheets", sheetAccount);
  const names = await run("googlesheets", sheetAccount, "sheets.sheet_names", { spreadsheetId: SHEET_ID });
  if (!names.sheet_names?.includes("Mail")) throw new Error("The new Mail tab could not be verified.");
  const header = await run("googlesheets", sheetAccount, "sheets.read_range", { spreadsheetId: SHEET_ID, range: "Mail!A1:D1" });
  if (JSON.stringify(header.values?.[0]) !== JSON.stringify(["Received at (UTC)", "From", "Subject", "Message ID"])) throw new Error("Sheet headers changed. Activation stopped.");
  await db.execute(sql`INSERT INTO mail_flows(user_id,sheets_account_id,status) VALUES(${OWNER},${sheetAccount},'starting') ON CONFLICT(user_id) DO NOTHING`);
  const current = (await db.execute(sql`SELECT * FROM mail_flows WHERE user_id=${OWNER}`))[0];
  if (current.sheets_account_id !== sheetAccount) throw new Error("A different Sheets connection is already pinned.");
  if (current.status === "active") return { success: true };
  // Start boundary precedes subscription creation. No inbox history is fetched.
  await db.execute(sql`UPDATE mail_flows SET activated_at=COALESCE(activated_at,now()),status='starting' WHERE user_id=${OWNER}`);
  const t = await providerFor("outlook").registerTrigger({ userId: OWNER, connectionId: OUTLOOK, event: "mail.received", webhookUrl: "https://active-clone.vercel.app/api/mail-flow/webhook" });
  await db.execute(sql`UPDATE mail_flows SET trigger_id=${t.triggerId},status='active' WHERE user_id=${OWNER}`);
  return { success: true, triggerId: t.triggerId };
}
export async function retryMail(id: string, mid: string) {
  requireOwner(id);
  const event = (await db.execute(sql`SELECT status FROM mail_flow_events WHERE user_id=${OWNER} AND message_id=${mid}`))[0];
  if (!event || event.status === "success") throw new Error("No failed run to retry.");
  const flow = (await db.execute(sql`SELECT trigger_id FROM mail_flows WHERE user_id=${OWNER}`))[0];
  return handleMailEvent({ kind: "mail.received", userId: OWNER, connectionId: OUTLOOK, triggerId: String(flow.trigger_id), itemId: mid });
}
export async function handleMailEvent(ev: NormalizedEvent) {
  if (ev.kind !== "mail.received" || ev.userId !== OWNER || ev.connectionId !== OUTLOOK) throw new Error("Unexpected event provenance.");
  const flow = (await db.execute(sql`SELECT * FROM mail_flows WHERE user_id=${OWNER}`))[0];
  if (!flow || flow.status !== "active" || flow.trigger_id !== ev.triggerId) throw new Error("Flow is not active for this trigger.");
  const mid = ev.itemId;
  if (typeof mid !== "string" || mid.length > 2048 || !mid) throw new Error("Missing message ID.");
  // No event content, bodies, previews, recipients or raw payload are persisted.
  await requireConn("outlook", OUTLOOK); await requireConn("googlesheets", String(flow.sheets_account_id));
  const msg = await run("outlook", OUTLOOK, "mail.get_message", { id: mid });
  const mail = msg.message || msg;
  const received = Date.parse(mail.receivedDateTime);
  if (mail.id !== mid || !Number.isFinite(received)) throw new Error("Message metadata could not be verified.");
  if (received < new Date(flow.activated_at as string).getTime()) return { ignored: "before activation" };
  const row = [new Date(received).toISOString(), String(mail.from?.emailAddress?.address || ""), String(mail.subject || "").slice(0,49000), mid];
  const lease = randomUUID();
  const event = await db.transaction(async tx => {
    await tx.execute(sql`SELECT user_id FROM mail_flows WHERE user_id=${OWNER} FOR UPDATE`);
    let e = (await tx.execute(sql`SELECT * FROM mail_flow_events WHERE user_id=${OWNER} AND message_id=${mid}`))[0];
    if (!e) {
      const f = (await tx.execute(sql`SELECT next_row FROM mail_flows WHERE user_id=${OWNER}`))[0];
      if (Number(f.next_row) > 1000) throw new Error("Sheet capacity reached. Increase reviewed capacity before resuming.");
      e = (await tx.execute(sql`INSERT INTO mail_flow_events(user_id,message_id,row_number,status) VALUES(${OWNER},${mid},${f.next_row},'pending') RETURNING *`))[0];
      await tx.execute(sql`UPDATE mail_flows SET next_row=next_row+1 WHERE user_id=${OWNER}`);
    }
    if (e.status === "success") return null;
    if (e.lease_until && new Date(e.lease_until as string).getTime() > Date.now()) throw new Error("Event is already processing.");
    await tx.execute(sql`UPDATE mail_flow_events SET lease_token=${lease},lease_until=now()+interval '90 seconds',status='running',error=NULL,updated_at=now() WHERE user_id=${OWNER} AND message_id=${mid}`);
    return e;
  });
  if (!event) return { duplicate: true };
  const n = Number(event.row_number);
  try {
    const existing = await run("googlesheets", String(flow.sheets_account_id), "sheets.read_range", { spreadsheetId: SHEET_ID, range: `Mail!A${n}:D${n}` });
    const v = existing.values?.[0] || [];
    if (v.some((x: unknown) => x !== "" && x !== null) && v[3] !== mid) throw new Error("Reserved row was edited. Stopped without overwriting it.");
    if (JSON.stringify(v) !== JSON.stringify(row)) {
      // Fixed row update, never append: retry writes the same reserved row even after a lost response.
      await run("googlesheets", String(flow.sheets_account_id), "sheets.write_row", { spreadsheetId: SHEET_ID, sheet: "Mail", cell: `A${n}`, values: row });
    }
    const check = await run("googlesheets", String(flow.sheets_account_id), "sheets.read_range", { spreadsheetId: SHEET_ID, range: `Mail!A${n}:D${n}` });
    if (JSON.stringify(check.values?.[0]) !== JSON.stringify(row)) throw new Error("Written row could not be verified.");
    await db.execute(sql`UPDATE mail_flow_events SET status='success',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE user_id=${OWNER} AND message_id=${mid} AND lease_token=${lease}`);
    return { success: true, row: n };
  } catch (e) {
    const error = safeFlowError(e);
    await db.execute(sql`UPDATE mail_flow_events SET status='error',error=${error},lease_until=NULL,lease_token=NULL,updated_at=now() WHERE user_id=${OWNER} AND message_id=${mid} AND lease_token=${lease}`);
    throw new Error(error);
  }
}
