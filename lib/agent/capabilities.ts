import "server-only";
import { describeToolkit } from "@/lib/connectors/generic";
import { myConnections } from "@/lib/connectors";
import { PRESETS } from "@/lib/connectors/presets";
import { listNativeApps, listNativeConnections, nativeOAuthApp } from "@/lib/integrations/directory";

// One shared source of truth about what the product can do and what the user has connected.
// The unified chat agent reads it; the builder keeps its own action catalog (ids + example configs) but never contradicts it.
export type ConnStatus = "connected" | "not_connected" | "pending" | "needs_attention" | "check_failed";
const ALIASES: Record<string, string> = { microsoft_outlook: "outlook", google_sheets: "googlesheets" };
export const canonicalApp = (slug: string) => ALIASES[slug.toLowerCase()] ?? slug.toLowerCase();

export async function connectionStatuses(userId: string, slugs: string[]): Promise<Record<string, ConnStatus>> {
  const out: Record<string, ConnStatus> = {};
  const nativeIds = new Set(listNativeApps().map(a => String(a.id)));
  let nativeConnected: Set<string> | null = null;
  const unique = [...new Set(slugs.map(canonicalApp))];
  await Promise.all(unique.map(async slug => {
    try {
      if (nativeIds.has(slug)) {
        nativeConnected ??= new Set((await listNativeConnections(userId)).map(c => String(c.appId)));
        out[slug] = nativeConnected.has(slug) ? "connected" : "not_connected";
        return;
      }
      const entries = (await myConnections(userId, [slug]))[slug] ?? [];
      out[slug] = entries.some(c => c.status === "active") ? "connected" : entries.some(c => c.status === "pending") ? "pending" : entries.some(c => c.status === "needs_attention" || c.status === "failed") ? "needs_attention" : "not_connected";
    } catch { out[slug] = "check_failed"; }
  }));
  return out;
}

/** Compact catalog for the agent's prompt: every native app with what it does, how it connects, and its live status. */
export async function catalogText(userId: string): Promise<string> {
  const apps = listNativeApps();
  let connected = new Set<string>();
  try { connected = new Set((await listNativeConnections(userId)).map(c => String(c.appId))); } catch { /* status unknown */ }
  const lines = apps.map(a => {
    const how = a.connect.kind === "oauth" ? "one-click connect" : a.formFields.length ? `connects on the Connections page with: ${a.formFields.map(f => f.label).join(", ")}` : "no connection needed";
    const status = a.formFields.length || a.connect.kind === "oauth" ? (connected.has(String(a.id)) ? "CONNECTED" : "not connected") : "ready";
    return `- ${a.id} (${a.name}) [${status}; ${how}]: ${a.description.slice(0, 110)}. Actions: ${a.actions.slice(0, 14).join(", ") || "none"}${a.triggers.length ? `. Triggers: ${a.triggers.join(", ")}` : ""}`;
  });
  return [
    "NATIVE APPS (this is the real list; if an app or action is not here or in the built-in steps, do not promise it):",
    ...lines,
    "BUILT-IN STEPS: triggers Manual (run by hand), Schedule (every N minutes/daily), Webhook; steps for HTTP Request, Condition, Loop over a list (up to 50 items), Formula, Run Composio Action (external apps like Gmail, Outlook, Google Sheets, Notion, Airtable, Google Docs/Drive, HubSpot, Jira).",
    "Composio apps connect with one-click cards (gmail, outlook, googlesheets have reviewed minimal-permission presets).",
  ].join("\n");
}

export type ConnectCard = Record<string, unknown>;
export type ConnectOutcome =
  | { kind: "card"; card: ConnectCard }
  | { kind: "already_connected" }
  | { kind: "manual"; name: string; fields: string[] }
  | { kind: "pending" | "check_failed" }
  | { kind: "unknown_app" };

export async function connectOutcome(userId: string, rawSlug: string): Promise<ConnectOutcome> {
  const slug = canonicalApp(rawSlug);
  const native = listNativeApps().find(a => String(a.id) === slug);
  const status = (await connectionStatuses(userId, [slug]))[slug];
  if (status === "connected") return { kind: "already_connected" };
  if (status === "check_failed") return { kind: "check_failed" };
  if (status === "pending") return { kind: "pending" };
  if (native) {
    const oauth = nativeOAuthApp(slug);
    if (oauth) return { kind: "card", card: { native: true, toolkitId: oauth.id, title: oauth.name, installPath: `${oauth.installPath}?popup=1`, grants: [], doesNotGrant: [], consentHint: "", generic: false } };
    return { kind: "manual", name: native.name, fields: native.formFields.map(f => f.label) };
  }
  if (PRESETS[slug]) return { kind: "card", card: { ...PRESETS[slug], generic: false, needsAttention: status === "needs_attention" } };
  const t = await describeToolkit(slug).catch(() => null);
  if (t && ((t.oauth && t.managed) || t.keyScheme)) return { kind: "card", card: { toolkitId: t.id, title: t.name, grants: [], doesNotGrant: [], consentHint: "", generic: true, apiKey: !t.managed } };
  return { kind: "unknown_app" };
}
