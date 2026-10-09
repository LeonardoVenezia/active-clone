import "server-only";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";

const BASE = "https://backend.composio.dev/api/v3";
const VERSION = "20260922_00";
const ALLOWED = ["HACKERNEWS_GET_TOP_STORIES", "HACKERNEWS_GET_ITEM"];

async function request(path: string, body?: Record<string, unknown>) {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY is not configured on the server.");
  const response = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    // Never echo provider response bodies or headers containing credentials.
    throw new Error(response.status === 401 || response.status === 403
      ? "Composio authentication failed. Check the server project key."
      : response.status === 429 ? "Composio rate limit reached. No automatic retry."
      : `Composio request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

type CatalogInput = StepInput & { catalog?: string; search?: string; integrationId?: string };
export async function discoverComposio(input: CatalogInput) {
  const tools = input.catalog === "hackernews";
  if (input.catalog && !["toolkits", "hackernews"].includes(input.catalog)) throw new Error("Unsupported catalog.");
  const params = new URLSearchParams({ limit: "20" });
  if (tools) {
    params.set("toolkit_slug", "hackernews"); params.set("toolkit_versions", VERSION);
    params.set("tool_slugs", ALLOWED.join(","));
  } else if (input.search) params.set("search", String(input.search).slice(0, 100));
  const result = await request(`/${tools ? "tools" : "toolkits"}?${params}`);
  const items = (Array.isArray(result.items) ? result.items : []).slice(0, 20).map((x: Record<string, unknown>) => ({
    slug: x.slug, name: x.name, no_auth: x.no_auth, version: x.version,
    ...(tools ? { input_parameters: x.input_parameters, output_parameters: x.output_parameters, tags: x.tags } : { meta: x.meta, auth_schemes: x.auth_schemes }),
  }));
  return { success: true, items, count: items.length, nextCursor: result.next_cursor ?? null, totalItems: result.total_items ?? null };
}

export async function discoverComposioStep(input: CatalogInput) {
  "use step";
  return withStepLogging(input, async () => {
    try { return await discoverComposio(input); }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : "Composio discovery failed." }; }
  });
}
discoverComposioStep.maxRetries = 0;

export async function readHackerNewsStep(input: StepInput & { tool?: string; itemId?: string; integrationId?: string }) {
  "use step";
  return withStepLogging(input, async () => {
    if (process.env.COMPOSIO_PUBLIC_READS_ENABLED !== "true") return { success: false, error: "Composio execution is disabled pending owner verification of plan, quota and billing limits. Discovery remains available." };
    const tool = input.tool || ALLOWED[0];
    if (!ALLOWED.includes(tool)) return { success: false, error: "Only the two public Hacker News read actions are allowed. OAuth and arbitrary tools are disabled." };
    const id = Number(input.itemId);
    if (tool === ALLOWED[1] && (!Number.isSafeInteger(id) || id <= 0)) return { success: false, error: "Item ID must be a positive integer." };
    try {
      const result = await request(`/tools/execute/${tool}`, { version: VERSION, arguments: tool === ALLOWED[1] ? { id } : {} });
      if (result.successful !== true) return { success: false, error: "Composio tool returned an unsuccessful result." };
      return { success: true, data: result.data };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Composio read failed." }; }
  });
}
readHackerNewsStep.maxRetries = 0;
export const _integrationType = "composio";
