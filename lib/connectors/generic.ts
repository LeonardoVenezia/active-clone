import "server-only";
// Generic connect for ANY Composio toolkit, via Composio-managed auth. Reviewed presets (presets.ts) stay the minimal-scope shortcuts.
// Managed auth cannot narrow scopes, so the UI must disclose that and get an explicit acknowledgement before connecting.
const BASE = "https://backend.composio.dev/api/v3";
type Row = Record<string, any>;
async function api(path: string, body?: Row): Promise<Row> {
  const key = process.env.COMPOSIO_API_KEY; if (!key) throw new Error("Integrations are not configured on the server.");
  const r = await fetch(BASE + path, { method: body ? "POST" : "GET", cache: "no-store", headers: { "x-api-key": key, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`The integration provider request failed (HTTP ${r.status}).`);
  return r.json();
}
const SLUG = /^[a-z0-9_]{1,60}$/;
// Composio tool slugs are uppercase (e.g. NOTION_CREATE_PAGE); toolkit slugs stay lowercase.
const TOOL_SLUG = /^[A-Za-z0-9_]{1,80}$/;
export type GenericToolkit = { id: string; name: string; description: string; logoUrl: string | null; oauth: boolean; managed: boolean; keyScheme: string | null };
export async function describeToolkit(slug: string): Promise<GenericToolkit | null> {
  if (!SLUG.test(slug)) return null;
  const t = await api(`/toolkits/${encodeURIComponent(slug)}`).catch(() => null);
  if (!t || !t.slug) return null;
  const schemes: string[] = (Array.isArray(t.auth_config_details) ? t.auth_config_details : []).map((d: Row) => String(d.mode ?? "").toUpperCase());
  const managed = t.composio_managed_auth_schemes ? (t.composio_managed_auth_schemes as unknown[]).length > 0 : false;
  const keyScheme = schemes.includes("API_KEY") ? "API_KEY" : schemes.includes("BEARER_TOKEN") ? "BEARER_TOKEN" : null;
  return { keyScheme, id: String(t.slug).toLowerCase(), name: String(t.name ?? slug), description: String(t.meta?.description ?? "").slice(0, 240), logoUrl: typeof t.meta?.logo === "string" ? t.meta.logo : null, oauth: schemes.some(s => s.includes("OAUTH")), managed };
}
async function keyConfigId(slug: string, scheme: string): Promise<string> {
  const l = await api(`/auth_configs?toolkit_slug=${encodeURIComponent(slug)}&limit=20`);
  const found = (l.items ?? []).find((c: Row) => c.status === "ENABLED" && c.is_composio_managed !== true && String(c.toolkit?.slug).toLowerCase() === slug && String(c.auth_scheme ?? "").toUpperCase() === scheme);
  if (found) return String(found.id);
  const c = await api("/auth_configs", { toolkit: { slug }, auth_config: { type: "use_custom_auth", authScheme: scheme, credentials: {} } });
  const id = c.auth_config?.id; if (typeof id !== "string") throw new Error("Could not set up this app.");
  return id;
}
async function managedConfigId(slug: string): Promise<string> {
  const l = await api(`/auth_configs?toolkit_slug=${encodeURIComponent(slug)}&is_composio_managed=true&limit=5`);
  const found = (l.items ?? []).find((c: Row) => c.status === "ENABLED" && c.is_composio_managed === true && String(c.toolkit?.slug).toLowerCase() === slug);
  if (found) return String(found.id);
  const c = await api("/auth_configs", { toolkit: { slug }, auth_config: { type: "use_composio_managed_auth" } });
  const id = c.auth_config?.id; if (typeof id !== "string") throw new Error("Could not set up this app.");
  return id;
}
export async function genericConnect(userId: string, slug: string, callbackUrl: string): Promise<{ redirectUrl: string }> {
  const t = await describeToolkit(slug); if (!t) throw new Error("Unknown app.");
  if (!t.managed && !t.keyScheme) throw new Error("This app has no managed sign-in or API-key option. It needs its own OAuth app, which is not set up yet.");
  const cfg = t.managed ? await managedConfigId(t.id) : await keyConfigId(t.id, t.keyScheme as string);
  const l = await api("/connected_accounts/link", { auth_config_id: cfg, user_id: userId, callback_url: callbackUrl, experimental: { account_type: "PRIVATE" } });
  const u = new URL(String(l.redirect_url));
  if (u.protocol !== "https:" || !(u.hostname === "composio.dev" || u.hostname.endsWith(".composio.dev"))) throw new Error("Unexpected consent destination. Connection stopped.");
  return { redirectUrl: u.toString() };
}
export async function genericActive(userId: string, slug: string): Promise<boolean> {
  if (!SLUG.test(slug)) return false;
  const r = await api(`/connected_accounts?user_ids=${encodeURIComponent(userId)}&toolkit_slugs=${encodeURIComponent(slug)}&limit=20`);
  return (r.items ?? []).some((a: Row) => a.user_id === userId && a.status === "ACTIVE" && !a.is_disabled && String(a.toolkit?.slug).toLowerCase() === slug);
}

export type ToolkitTool = { slug: string; name: string; description: string };
export async function listToolkitTools(slug: string): Promise<ToolkitTool[]> {
  if (!SLUG.test(slug)) return [];
  const r = await api(`/tools?${new URLSearchParams({ toolkit_slug: slug, toolkit_versions: "latest", limit: "100" })}`);
  const items = Array.isArray(r.items) ? r.items : [];
  return items
    .map((t: Row) => ({
      slug: String(t.slug ?? ""),
      name: String(t.name ?? t.meta?.name ?? t.slug ?? ""),
      description: String(t.description ?? t.meta?.description ?? "").slice(0, 200),
    }))
    .filter((t: ToolkitTool) => TOOL_SLUG.test(t.slug));
}

export type ToolkitToolSchema = { slug: string; name: string; description: string; inputParameters: Row | null };
export async function getToolkitTool(toolkit: string, tool: string): Promise<ToolkitToolSchema | null> {
  if (!SLUG.test(toolkit) || !TOOL_SLUG.test(tool)) return null;
  const r = await api(`/tools?${new URLSearchParams({ tool_slugs: tool, toolkit_versions: "latest", limit: "5" })}`);
  const items = Array.isArray(r.items) ? r.items : [];
  const t = items.find((i: Row) => String(i.slug ?? "").toUpperCase() === tool.toUpperCase() && String(i.toolkit?.slug ?? "").toLowerCase() === toolkit);
  if (!t) return null;
  return {
    slug: String(t.slug ?? ""),
    name: String(t.name ?? t.slug ?? ""),
    description: String(t.description ?? "").slice(0, 300),
    inputParameters: t.input_parameters && typeof t.input_parameters === "object" ? (t.input_parameters as Row) : null,
  };
}
