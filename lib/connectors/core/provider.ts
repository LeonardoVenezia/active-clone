import type { TestResult, ActionResult, Connection, NormalizedEvent, ToolkitPage, TriggerRef, Verification, Preset } from "./types";
// The one interface the app talks to. A vendor (Composio) or a custom integration (e.g. MercadoPago) implements it.
export interface IntegrationProvider {
  readonly id: string;
  listToolkits(opts: { query?: string; cursor?: string; limit?: number }): Promise<ToolkitPage>;
  beginConnect(opts: { userId: string; preset: Preset; callbackUrl: string }): Promise<{ redirectUrl: string }>;
  listConnections(opts: { userId: string; preset: Preset }): Promise<Connection[]>;
  verify(opts: { userId: string; connectionId: string; preset: Preset }): Promise<Verification>;
  testConnection(opts: { userId: string; connectionId: string; preset: Preset }): Promise<TestResult>;
  execute<T = unknown>(opts: { userId: string; connectionId: string; capability: string; input: Record<string, unknown> }): Promise<ActionResult<T>>;
  registerTrigger(opts: { userId: string; connectionId: string; event: string; webhookUrl: string }): Promise<TriggerRef>;
  // Pause or resume event delivery without losing the trigger. Keeps the trigger id stable.
  setTriggerEnabled(opts: { userId: string; triggerId: string; enabled: boolean }): Promise<void>;
  removeTrigger(opts: { userId: string; triggerId: string }): Promise<void>;
  parseWebhook(headers: Headers, rawBody: string): NormalizedEvent;
}
