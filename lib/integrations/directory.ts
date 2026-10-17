import "server-only";

// Single source of truth for "which apps exist, how they connect, and what is
// connected". Both /connections and the chats read from here.
//
// Sources:
// - Native apps: the plugin registry (plugins/). Same data the editor and the
//   workflow runner use.
// - Composio apps: the vendor-neutral provider in lib/connectors. Composio is
//   one provider behind that interface; replacing it never touches this file.

import { getIntegrations } from "@/lib/db/integrations";
import type { IntegrationType } from "@/lib/types/integration";
import { getAllIntegrations } from "@/plugins";

export type NativeConnect =
  | { kind: "oauth"; path: string } // GET starts the provider consent flow
  | { kind: "manual" }; // credential form (lives in the editor today)

export type DirectoryApp = {
  id: IntegrationType;
  name: string;
  description: string;
  source: "native";
  group: "app" | "platform";
  connect: NativeConnect;
  actions: string[]; // action labels, same registry the editor shows
  triggers: string[]; // trigger labels
};

export type DirectoryConnection = {
  id: string;
  appId: IntegrationType;
  source: "native";
  label: string;
  status: "active"; // a saved native connection is usable
  createdAt: string;
};

// Native apps with an OAuth consent flow (route exists under /api/integrations).
const OAUTH_INSTALL: Partial<Record<IntegrationType, string>> = {
  mercadolibre: "/api/integrations/mercadolibre/install",
  mercadopago: "/api/integrations/mercadopago/install",
};

// The "composio" plugin is the bridge that runs Composio actions in workflows;
// Composio apps are listed through the lib/connectors provider, not here.
const EXCLUDED: ReadonlySet<string> = new Set(["composio"]);

// Platform/infra plugins: real plugins, but building blocks of the app itself,
// not apps a user connects for their business. Shown collapsed under
// "Plataforma" on /connections (agreed with the owner).
const PLATFORM: ReadonlySet<string> = new Set([
  "ai-gateway",
  "blob",
  "clerk",
  "fal",
  "firecrawl",
  "perplexity",
  "superagent",
  "v0",
]);

export function listNativeApps(): DirectoryApp[] {
  return getAllIntegrations()
    .filter((plugin) => !EXCLUDED.has(plugin.type))
    .map((plugin) => {
      const install = OAUTH_INSTALL[plugin.type];
      return {
        id: plugin.type,
        name: plugin.label,
        description: plugin.description,
        source: "native" as const,
        group: PLATFORM.has(plugin.type) ? ("platform" as const) : ("app" as const),
        connect: install
          ? ({ kind: "oauth", path: install } as const)
          : ({ kind: "manual" } as const),
        actions: plugin.actions.map((action) => action.label),
        triggers: (plugin.triggers ?? []).map((trigger) => trigger.label),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listNativeConnections(
  userId: string
): Promise<DirectoryConnection[]> {
  const integrations = await getIntegrations(userId);
  return integrations
    .filter((integration) => !EXCLUDED.has(integration.type))
    .map((integration) => ({
      id: integration.id,
      appId: integration.type,
      source: "native" as const,
      label: integration.name,
      status: "active" as const,
      createdAt: integration.createdAt.toISOString(),
    }));
}

// Short plain-text summary for chat system contexts. Names only, never secrets.
export async function nativeChatContext(userId: string): Promise<string> {
  const apps = listNativeApps();
  const connections = await listNativeConnections(userId);
  const connectedIds = new Set(connections.map((c) => c.appId));
  const connected = apps
    .filter((a) => connectedIds.has(a.id))
    .map((a) => a.name);
  const available = apps
    .filter((a) => a.group === "app" && !connectedIds.has(a.id))
    .map((a) => a.name);
  return [
    "Native apps from the same integration registry shown on /connections (these connect outside the chat; never ask the user for keys in chat):",
    `- Connected: ${connected.length ? connected.join(", ") : "none yet"}`,
    `- Available but not connected: ${available.join(", ")}`,
  ].join("\n");
}
