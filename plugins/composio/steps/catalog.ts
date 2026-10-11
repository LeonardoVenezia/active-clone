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

type CatalogInput = StepInput & { catalog?: string; search?: string; toolkit?: string; integrationId?: string };
export async function discoverComposio(input: CatalogInput) {
  const hackerNewsTools = input.catalog === "hackernews";
  const toolkitTools = input.catalog === "tools";
  if (input.catalog && !["toolkits", "hackernews", "tools"].includes(input.catalog)) throw new Error("Unsupported catalog.");
  const toolkit = String(input.toolkit ?? "").trim().toLowerCase();
  if (toolkitTools && !/^[a-z0-9_]{1,80}$/.test(toolkit)) throw new Error("Choose a valid Composio app first.");
  const params = new URLSearchParams({ limit: toolkitTools ? "100" : "20" });
  if (hackerNewsTools) {
    params.set("toolkit_slug", "hackernews"); params.set("toolkit_versions", VERSION);
    params.set("tool_slugs", ALLOWED.join(","));
  } else if (toolkitTools) {
    params.set("toolkit_slug", toolkit); params.set("toolkit_versions", "latest");
  } else if (input.search) params.set("search", String(input.search).slice(0, 100));
  const result = await request(`/${hackerNewsTools || toolkitTools ? "tools" : "toolkits"}?${params}`);
  let rawItems: Record<string, unknown>[] = Array.isArray(result.items) ? result.items : [];
  let cursor: string | null = typeof result.next_cursor === "string" ? result.next_cursor : null;
  // Read bounded pages so larger toolkits do not silently omit valid actions.
  for (let page = 1; toolkitTools && cursor && page < 5; page++) {
    const nextParams = new URLSearchParams({ limit: "100", toolkit_slug: toolkit, toolkit_versions: "latest", cursor });
    const next = await request(`/tools?${nextParams}`);
    rawItems = rawItems.concat(Array.isArray(next.items) ? next.items : []);
    cursor = typeof next.next_cursor === "string" ? next.next_cursor : null;
  }
  const items = rawItems.slice(0, toolkitTools ? 500 : 20).map((x: Record<string, unknown>) => ({
    slug: x.slug, name: x.name, no_auth: x.no_auth, version: x.version,
    ...((hackerNewsTools || toolkitTools) ? { description: x.description, input_parameters: x.input_parameters, output_parameters: x.output_parameters, tags: x.tags } : { meta: x.meta, auth_schemes: x.auth_schemes }),
  }));
  return { success: true, items, count: items.length, nextCursor: cursor, totalItems: result.total_items ?? null };
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
