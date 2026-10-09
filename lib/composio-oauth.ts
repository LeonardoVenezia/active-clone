import "server-only";

const BASE = "https://backend.composio.dev/api/v3";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CONFIG_NAME = "Active-clone Gmail read-only v1";
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
  const c = await request(`/auth_configs/${encodeURIComponent(id)}`);
  return c.toolkit?.slug?.toLowerCase() === "gmail" && c.auth_scheme === "OAUTH2" && c.status === "ENABLED" && readonlyScope(c.credentials?.scopes);
}
async function authConfig() {
  const result = await request(`/auth_configs?${new URLSearchParams({ toolkit_slug: "gmail", search: CONFIG_NAME, limit: "100" })}`);
  for (const c of result.items ?? []) {
    if (c.name === CONFIG_NAME && await configValid(c.id)) return c.id as string;
  }
  const created = await request("/auth_configs", {
    toolkit: { slug: "gmail" },
    auth_config: { type: "use_composio_managed_auth", name: CONFIG_NAME, credentials: { scopes: GMAIL_SCOPE } },
  });
  const id = created.auth_config?.id;
  if (typeof id !== "string" || !await configValid(id)) throw new Error("Read-only auth config could not be verified. Connection stopped.");
  return id;
}
// The session owns userId. Never accept it from a form or callback query.
async function ownAccounts(userId: string, id?: string) {
  const params = new URLSearchParams({ user_ids: userId, limit: "100", account_type: "PRIVATE" });
  if (id) params.set("connected_account_ids", id);
  const result = await request(`/connected_accounts?${params}`);
  return (result.items ?? []).filter((a: Row) => a.toolkit?.slug?.toLowerCase() === "gmail" && (!a.user_id || a.user_id === userId) && (!id || a.id === id) && a.experimental?.account_type !== "SHARED");
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
  if (!account || account.status !== "ACTIVE" || account.is_disabled || !readonlyScope(account.requested_scopes) || !await configValid(account.auth_config?.id)) throw new Error("An active, owned, verified read-only Gmail connection is required.");
  const result = await request(`/tools/execute/${TOOL}`, { connected_account_id: account.id, user_id: userId, version: VERSION, arguments: { user_id: "me", max_results: 5, ids_only: true, include_payload: false, verbose: false } });
  if (result.successful !== true) throw new Error("Gmail read returned an unsuccessful result.");
  const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  // Test returns IDs only. No bodies, headers, tokens or provider state reach the browser.
  return { success: true, count: messages.length, messageIds: messages.slice(0, 5).map((m: Row) => String(m.id ?? m.messageId ?? "")).filter(Boolean) };
}
