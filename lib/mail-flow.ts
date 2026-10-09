import "server-only";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
const BASE = "https://backend.composio.dev/api/v3";
export const SHEET_ID = "1DYNb-dD3k1vJOkJ20eVmJbTxcjtf523UAO--3pWtDjg";
export const SHEET_URL = "https://docs.google.com/spreadsheets/d/1DYNb-dD3k1vJOkJ20eVmJbTxcjtf523UAO--3pWtDjg/edit?authuser=leovenezia%40outlook.com.ar";
const OWNER = "eSAgtpycnNp3JewTMni591wPxlMj6yJI";
const OUTLOOK = "ca_yCkXFi2Yv9mw";
const CONFIG = "ac_GUA-bnbuicij";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/userinfo.email"];
type Obj = Record<string, any>;
export function safeFlowError(e: unknown) {
  const message = e instanceof Error ? e.message : "Flow request failed.";
  if (/failed query|params:|postgres|sql|relation .*exist|column .*exist|database|connect econn|socket/i.test(message)) return "Flow storage operation failed. No completed activation was confirmed. Refresh status before retrying; if it persists, contact support.";
  return message.slice(0,700);
}
export function requireOwner(id: string) { if (id !== OWNER) throw new Error("This flow is private to its owner."); }
async function api(path: string, body?: Obj): Promise<Obj> {
  if (!process.env.COMPOSIO_API_KEY) throw new Error("Server connection not configured.");
  const r = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { "x-api-key": process.env.COMPOSIO_API_KEY, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`Provider request failed (HTTP ${r.status}).`);
  return r.json();
}
function list(v: unknown): string[] { return Array.isArray(v) ? v : typeof v === "string" ? v.split(/[ ,]+/).filter(Boolean) : []; }
function sheetsScope(v: unknown) { const s = list(v); return s.includes(SCOPES[0]) && s.every(x => [...SCOPES, "openid", "email", "profile"].includes(x)); }
async function validConfig() {
  const c = await api(`/auth_configs/${CONFIG}`);
  if (c.type !== "custom" || c.is_composio_managed !== false || c.status !== "ENABLED" || c.toolkit?.slug !== "googlesheets" || c.credentials?.client_id !== "718373983926-c1sof08k6k69os2sqiq5r0f2g5o04qrd.apps.googleusercontent.com" || c.credentials?.oauth_redirect_uri !== "https://backend.composio.dev/api/v3/toolkits/auth/callback" || list(c.credentials?.scopes).length !== 2 || !SCOPES.every(x => list(c.credentials?.scopes).includes(x))) throw new Error("Sheets configuration could not be verified.");
}
async function account(id: string, toolkit: string) {
  const a = await api(`/connected_accounts/${encodeURIComponent(id)}`);
  if (a.user_id !== OWNER || a.experimental?.account_type !== "PRIVATE" || a.toolkit?.slug !== toolkit || a.status !== "ACTIVE" || a.is_disabled) throw new Error("Active private owner connection required.");
  if (toolkit === "googlesheets") {
    if (a.auth_config?.id !== CONFIG || !sheetsScope(a.requested_scopes)) throw new Error("Sheets requested configuration could not be verified.");
    if (!sheetsScope(a.state?.val?.scope || a.data?.scope)) throw new Error("Google did not grant spreadsheet access. Click Connect Google Sheets again and select the spreadsheets permission on the Google consent screen, then activate the new connection. Existing connection was not revoked.");
    await validConfig();
  } else {
    const grant = list(a.state?.val?.scope || a.data?.scope);
    if (a.auth_config?.id !== "ac_GJdxOyKYTKtt" || !grant.includes("Mail.Read") || grant.some(x => !["Mail.Read", "User.Read", "offline_access"].includes(x))) throw new Error("Read-only Outlook grant required.");
  }
  return a;
}
async function tool(id: string, name: string, args: Obj, version = "20261001_00") {
  const r = await api(`/tools/execute/${name}`, { connected_account_id: id, user_id: OWNER, version, arguments: args });
  if (r.successful !== true) throw new Error(`${name} failed. No automatic append retry.`);
  return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
}
export async function connectSheets(id: string, callback: string) {
  requireOwner(id); await validConfig();
  const r = await api("/connected_accounts/link", { auth_config_id: CONFIG, user_id: OWNER, callback_url: callback, experimental: { account_type: "PRIVATE" } });
  const u = new URL(r.redirect_url);
  if (u.protocol !== "https:" || !(u.hostname === "composio.dev" || u.hostname.endsWith(".composio.dev"))) throw new Error("Unexpected consent destination.");
  return { redirectUrl: u.toString() };
}
export async function flowStatus(id: string) {
  requireOwner(id);
  const flows = await db.execute(sql`SELECT status, trigger_id, sheets_account_id, activated_at, next_row FROM mail_flows WHERE user_id=${OWNER}`);
  const runs = await db.execute(sql`SELECT message_id, row_number, status, error, updated_at FROM mail_flow_events WHERE user_id=${OWNER} ORDER BY updated_at DESC LIMIT 20`);
  const a = await api(`/connected_accounts?user_ids=${OWNER}&account_type=PRIVATE&limit=100`);
  return { flow: flows[0] || null, runs: [...runs].map(r => ({...r,error:r.error ? safeFlowError(new Error(String(r.error))) : null})), accounts: (a.items || []).filter((x: Obj) => x.user_id === OWNER && x.toolkit?.slug === "googlesheets" && x.auth_config?.id === CONFIG && x.experimental?.account_type !== "SHARED").map((x: Obj) => ({ id: x.id, status: x.status })), sheetUrl: SHEET_URL };
}
export async function activateFlow(id: string, sheetAccount: string) {
  requireOwner(id); await account(OUTLOOK, "outlook"); await account(sheetAccount, "googlesheets");
  const names = await tool(sheetAccount, "GOOGLESHEETS_GET_SHEET_NAMES", { spreadsheet_id: SHEET_ID });
  if (!names.sheet_names?.includes("Mail")) throw new Error("The new Mail tab could not be verified.");
  const header = await tool(sheetAccount, "GOOGLESHEETS_VALUES_GET", { spreadsheet_id: SHEET_ID, range: "Mail!A1:D1" });
  if (JSON.stringify(header.values?.[0]) !== JSON.stringify(["Received at (UTC)", "From", "Subject", "Message ID"])) throw new Error("Sheet headers changed. Activation stopped.");
  await db.execute(sql`INSERT INTO mail_flows(user_id,sheets_account_id,status) VALUES(${OWNER},${sheetAccount},'starting') ON CONFLICT(user_id) DO NOTHING`);
  const current = (await db.execute(sql`SELECT * FROM mail_flows WHERE user_id=${OWNER}`))[0];
  if (current.sheets_account_id !== sheetAccount) throw new Error("A different Sheets connection is already pinned.");
  if (current.status === "active") return { success: true };
  // Start boundary precedes subscription creation. No inbox history is fetched.
  await db.execute(sql`UPDATE mail_flows SET activated_at=COALESCE(activated_at,now()),status='starting' WHERE user_id=${OWNER}`);
  const t = await api("/trigger_instances/OUTLOOK_MESSAGE_TRIGGER/upsert", { connected_account_id: OUTLOOK, user_id: OWNER, trigger_config: { folder_id: "inbox" }, toolkit_versions: { outlook: "20261009_00" }, egress_url: "https://active-clone.vercel.app/api/mail-flow/webhook" });
  if (typeof t.trigger_id !== "string") throw new Error("Trigger creation could not be verified.");
  await db.execute(sql`UPDATE mail_flows SET trigger_id=${t.trigger_id},status='active' WHERE user_id=${OWNER}`);
  return { success: true, triggerId: t.trigger_id };
}
export function signatureValid(headers: Headers, raw: string) {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  const id = headers.get("webhook-id"), ts = headers.get("webhook-timestamp"), sig = headers.get("webhook-signature");
  if (!secret || !id || !ts || !sig || !/^\d+$/.test(ts) || Math.abs(Date.now()/1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${id}.${ts}.${raw}`).digest("base64");
  return sig.split(/\s+/).some(s => { const v = s.startsWith("v1,") ? s.slice(3) : s; return v.length === expected.length && timingSafeEqual(Buffer.from(v), Buffer.from(expected)); });
}
export async function retryMail(id: string, mid: string) {
  requireOwner(id);
  const event = (await db.execute(sql`SELECT status FROM mail_flow_events WHERE user_id=${OWNER} AND message_id=${mid}`))[0];
  if (!event || event.status === "success") throw new Error("No failed run to retry.");
  const flow = (await db.execute(sql`SELECT trigger_id FROM mail_flows WHERE user_id=${OWNER}`))[0];
  return handleMailEvent({type:"composio.trigger.message", metadata:{user_id:OWNER, connected_account_id:OUTLOOK, auth_config_id:"ac_GJdxOyKYTKtt", trigger_slug:"OUTLOOK_MESSAGE_TRIGGER", trigger_id:flow.trigger_id},data:{id:mid}});
}
export async function handleMailEvent(payload: Obj) {
  const m = payload.metadata;
  if (payload.type !== "composio.trigger.message" || m?.user_id !== OWNER || m.connected_account_id !== OUTLOOK || m.auth_config_id !== "ac_GJdxOyKYTKtt" || m.trigger_slug !== "OUTLOOK_MESSAGE_TRIGGER") throw new Error("Unexpected event provenance.");
  const flow = (await db.execute(sql`SELECT * FROM mail_flows WHERE user_id=${OWNER}`))[0];
  if (!flow || flow.status !== "active" || flow.trigger_id !== m.trigger_id) throw new Error("Flow is not active for this trigger.");
  const mid = payload.data?.id || payload.data?.outlook_message?.id || payload.data?.message?.id;
  if (typeof mid !== "string" || mid.length > 2048 || !mid) throw new Error("Missing message ID.");
  // No event content, bodies, previews, recipients or raw payload are persisted.
  await account(OUTLOOK, "outlook"); await account(String(flow.sheets_account_id), "googlesheets");
  const msg = await tool(OUTLOOK, "OUTLOOK_GET_MESSAGE", { message_id: mid, user_id: "me", select: ["id", "receivedDateTime", "from", "subject"] }, "20261009_00");
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
    const existing = await tool(String(flow.sheets_account_id), "GOOGLESHEETS_VALUES_GET", { spreadsheet_id: SHEET_ID, range: `Mail!A${n}:D${n}` });
    const v = existing.values?.[0] || [];
    if (v.some((x: unknown) => x !== "" && x !== null) && v[3] !== mid) throw new Error("Reserved row was edited. Stopped without overwriting it.");
    if (JSON.stringify(v) !== JSON.stringify(row)) {
      // Fixed row update, never append: retry writes the same reserved row even after a lost response.
      await tool(String(flow.sheets_account_id), "GOOGLESHEETS_BATCH_UPDATE", { spreadsheet_id: SHEET_ID, sheet_name: "Mail", first_cell_location: `A${n}`, values: [row], value_input_option: "RAW", include_values_in_response: false });
    }
    const check = await tool(String(flow.sheets_account_id), "GOOGLESHEETS_VALUES_GET", { spreadsheet_id: SHEET_ID, range: `Mail!A${n}:D${n}` });
    if (JSON.stringify(check.values?.[0]) !== JSON.stringify(row)) throw new Error("Written row could not be verified.");
    await db.execute(sql`UPDATE mail_flow_events SET status='success',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE user_id=${OWNER} AND message_id=${mid} AND lease_token=${lease}`);
    return { success: true, row: n };
  } catch (e) {
    const error = safeFlowError(e);
    await db.execute(sql`UPDATE mail_flow_events SET status='error',error=${error},lease_until=NULL,lease_token=NULL,updated_at=now() WHERE user_id=${OWNER} AND message_id=${mid} AND lease_token=${lease}`);
    throw new Error(error);
  }
}
