import "server-only";
import { catalogProvider, providerFor } from "./registry";
import { presetFor } from "./presets";
import type { TestResult, Connection, ToolkitPage, Verification } from "./core/types";
export async function catalog(opts: { query?: string; cursor?: string }): Promise<ToolkitPage> { return catalogProvider().listToolkits({ ...opts, limit: 24 }); }
export async function myConnections(userId: string, toolkitIds: string[]): Promise<Record<string, Connection[]>> {
  const out: Record<string, Connection[]> = {};
  await Promise.all(toolkitIds.slice(0, 12).map(async id => { const p = presetFor(id); out[id] = p ? await providerFor(id).listConnections({ userId, preset: p }) : []; }));
  return out;
}
export async function connect(userId: string, toolkitId: string, callbackUrl: string) {
  const p = presetFor(toolkitId); if (!p) throw new Error("Permissions for this integration have not been reviewed yet.");
  return providerFor(toolkitId).beginConnect({ userId, preset: p, callbackUrl });
}
export async function verifyConnection(userId: string, toolkitId: string, connectionId: string): Promise<Verification> {
  const p = presetFor(toolkitId); if (!p) throw new Error("Permissions for this integration have not been reviewed yet.");
  return providerFor(toolkitId).verify({ userId, connectionId, preset: p });
}
export async function testConnection(userId: string, toolkitId: string, connectionId: string): Promise<TestResult> {
  const p = presetFor(toolkitId); if (!p) throw new Error("Permissions for this integration have not been reviewed yet.");
  return providerFor(toolkitId).testConnection({ userId, connectionId, preset: p });
}
