import "server-only";

const BASE = "https://backend.composio.dev/api/v3";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CONFIG_ID = "ac_BK5hd2o5ZRoT";
const GOOGLE_CLIENT_ID = "718373983926-c1sof08k6k69os2sqiq5r0f2g5o04qrd.apps.googleusercontent.com";
const GOOGLE_CALLBACK = "https://backend.composio.dev/api/v3/toolkits/auth/callback";
const TOOL = "GMAIL_FETCH_EMAILS";
const VERSION = "20261008_00";
type Row = Record<string, any>;

async function request(path: string, body?: Row): Promise<Row> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("Composio is not configured on the server.");
  const response = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Composio request failed (HTTP ${response.status}). No automatic retry.`);
  return response.json();
}
function scopes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "string" ? value.split(/[ ,]+/).filter(Boolean) : [];
}
function readonlyScope(value: unknown) {
  const list = scopes(value);
  return list.includes(GMAIL_SCOPE) && list.every(s => [GMAIL_SCOPE, "openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"].includes(s));
}
async function configValid(id: string) {
  if (id !== CONFIG_ID) return false;
  const c = await request(`/auth_configs/${encodeURIComponent(id)}`);
  const requested = scopes(c.credentials?.scopes);
  return c.type === "custom" && c.is_composio_managed === false &&
    c.toolkit?.slug?.toLowerCase() === "gmail" && c.auth_scheme === "OAUTH2" &&
    c.status === "ENABLED" && requested.length === 1 && requested[0] === GMAIL_SCOPE &&
    c.credentials?.client_id === GOOGLE_CLIENT_ID && c.credentials?.oauth_redirect_uri === GOOGLE_CALLBACK;
}
async function authConfig() {
  if (!await configValid(CONFIG_ID)) throw new Error("Custom read-only auth config could not be verified. Connection stopped.");
  return CONFIG_ID;
}
// The session owns userId. Never accept it from a form or callback query.
async function ownAccounts(userId: string, id?: string, toolkit = "gmail") {
  const params = new URLSearchParams({ user_ids: userId, limit: "100", account_type: "PRIVATE" });
  if (id) params.set("connected_account_ids", id);
  const result = await request(`/connected_accounts?${params}`);
  return (result.items ?? []).filter((a: Row) => a.toolkit?.slug?.toLowerCase() === toolkit && a.user_id === userId && (!id || a.id === id) && a.experimental?.account_type !== "SHARED");
}
export async function listGmailAccounts(userId: string) {
  const accounts = await ownAccounts(userId);
  return Promise.all(accounts.slice(0, 10).map(async (a: Row) => {
    const detail = await request(`/connected_accounts/${encodeURIComponent(a.id)}`);
    return { id: a.id, status: detail.status, alias: detail.alias || "Gmail", readOnly: readonlyScope(detail.requested_scopes) };
  }));
}
export async function connectGmail(userId: string, callback: string) {
  const id = await authConfig();
  const link = await request("/connected_accounts/link", { auth_config_id: id, user_id: userId, callback_url: callback, experimental: { account_type: "PRIVATE" } });
  const url = new URL(link.redirect_url);
  if (url.protocol !== "https:" || !(url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"))) throw new Error("Unexpected connection URL. Connection stopped.");
  return { redirectUrl: url.toString(), expiresAt: link.expires_at };
}
export async function testGmail(userId: string, id: string) {
  const owned = (await ownAccounts(userId, id))[0];
  if (!owned) throw new Error("Connection not found for this user.");
  const account = await request(`/connected_accounts/${encodeURIComponent(owned.id)}`);
  if (!account || account.user_id !== userId || account.experimental?.account_type !== "PRIVATE" || account.status !== "ACTIVE" || account.is_disabled || !readonlyScope(account.requested_scopes) || !await configValid(account.auth_config?.id)) throw new Error("An active, owned, verified read-only Gmail connection is required.");
  const result = await request(`/tools/execute/${TOOL}`, { connected_account_id: account.id, user_id: userId, version: VERSION, arguments: { user_id: "me", max_results: 5, ids_only: true, include_payload: false, verbose: false } });
  if (result.successful !== true) {
    const diagnostic = [result.error, result.data?.message].filter(v => typeof v === "string").join(" ");
    if (/mail service not enabled/i.test(diagnostic)) throw new Error("This Google account does not have Gmail enabled (Google HTTP 400: Mail service not enabled). Connecting a Google account with an Outlook email does not connect the Microsoft Outlook mailbox. Choose a Google account with an existing Gmail mailbox, or use an Outlook integration instead. Nothing was sent or changed.");
    throw new Error("Gmail read failed. No message IDs returned. Nothing was sent or changed.");
  }
  const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  // Test returns IDs only. No bodies, headers, tokens or provider state reach the browser.
  return { success: true, count: messages.length, messageIds: messages.slice(0, 5).map((m: Row) => String(m.id ?? m.messageId ?? "")).filter(Boolean) };
}

const OUTLOOK_CONFIG = "ac_GJdxOyKYTKtt";
const OUTLOOK_SCOPES = ["Mail.Read", "offline_access", "User.Read"];
function outlookReadonly(value: unknown) {
  const list = scopes(value);
  return list.includes("Mail.Read") && list.every(s => OUTLOOK_SCOPES.includes(s));
}
async function outlookConfigValid(id: string) {
  if (id !== OUTLOOK_CONFIG) return false;
  const c = await request(`/auth_configs/${encodeURIComponent(id)}`);
  const list = scopes(c.credentials?.scopes);
  return c.type === "default" && c.is_composio_managed === true && c.toolkit?.slug === "outlook" && c.auth_scheme === "OAUTH2" && c.status === "ENABLED" && list.length === OUTLOOK_SCOPES.length && OUTLOOK_SCOPES.every(s => list.includes(s));
}
export async function listOutlookAccounts(userId: string) {
  const accounts = await ownAccounts(userId, undefined, "outlook");
  return Promise.all(accounts.slice(0, 10).map(async (a: Row) => {
    const d = await request(`/connected_accounts/${encodeURIComponent(a.id)}`);
    if (d.user_id !== userId || d.experimental?.account_type !== "PRIVATE") throw new Error("Connection ownership could not be verified.");
    return { id: a.id, status: d.status, alias: d.alias || "Outlook", readOnly: outlookReadonly(d.requested_scopes) && d.auth_config?.id === OUTLOOK_CONFIG };
  }));
}
export async function connectOutlook(userId: string, callback: string) {
  if (!await outlookConfigValid(OUTLOOK_CONFIG)) throw new Error("Managed read-only Outlook config could not be verified. Connection stopped.");
  const link = await request("/connected_accounts/link", { auth_config_id: OUTLOOK_CONFIG, user_id: userId, callback_url: callback, experimental: { account_type: "PRIVATE" } });
  const url = new URL(link.redirect_url);
  if (url.protocol !== "https:" || !(url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"))) throw new Error("Unexpected connection URL. Connection stopped.");
  return { redirectUrl: url.toString(), expiresAt: link.expires_at };
}
export async function testOutlook(userId: string, id: string) {
  const owned = (await ownAccounts(userId, id, "outlook"))[0];
  if (!owned) throw new Error("Outlook connection not found for this user.");
  const account = await request(`/connected_accounts/${encodeURIComponent(owned.id)}`);
  if (account.user_id !== userId || account.experimental?.account_type !== "PRIVATE" || account.status !== "ACTIVE" || account.is_disabled || !outlookReadonly(account.requested_scopes) || !outlookReadonly(account.state?.val?.scope || account.data?.scope) || !await outlookConfigValid(account.auth_config?.id)) throw new Error("An active, owned, verified read-only Outlook connection is required.");
  const result = await request("/tools/execute/OUTLOOK_LIST_MESSAGES", { connected_account_id: account.id, user_id: userId, version: "20261009_00", arguments: { user_id: "me", folder: "inbox", top: 5, select: ["id"], response_detail: "minimal" } });
  if (result.successful !== true) throw new Error("Outlook read failed. No message IDs returned. Check the connected Microsoft account and its mailbox. Nothing was sent or changed.");
  const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
  if (!Array.isArray(data?.value)) throw new Error("Unexpected Outlook response. Cannot verify message IDs.");
  const messageIds = data.value.slice(0, 5).map((m: Row) => typeof m.id === "string" ? m.id : "").filter(Boolean);
  return { success: true, count: messageIds.length, messageIds };
}
