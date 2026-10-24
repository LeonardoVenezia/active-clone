import { errCode } from "@/lib/agent/err-code";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LlmRoute, llmRoutes } from "@/lib/free-models";

// QA model selector. `?ai=g` (Gemini) or `?ai=ds` (DeepSeek via Refuseless) pins the WHOLE journey (chat + builder) to one route
// with NO silent fallback. It only works for users listed in QA_AI_USER_IDS (comma separated, "*" = any signed-in user), so a URL can
// never let a stranger force a model. `ds` is a paid route: it additionally needs QA_ALLOW_PAID=1.
export type AiChoice = "g" | "ds";
export type Selection =
  | { ok: true; routes: LlmRoute[]; strict: boolean; choice: AiChoice | "auto" }
  | { ok: false; status: number; error: string };

const ALIASES: Record<string, AiChoice> = { g: "g", google: "g", gemini: "g", ds: "ds", deepseek: "ds" };

export function selectRoutes(ai: unknown, userId: string): Selection {
  const raw = typeof ai === "string" ? ai.trim().toLowerCase() : "";
  if (!raw || raw === "auto") return { ok: true, routes: llmRoutes(), strict: false, choice: "auto" };
  const choice = ALIASES[raw];
  if (!choice) return { ok: false, status: 400, error: `Unknown ai value "${raw.slice(0, 20)}". Use g or ds.` };
  const allowed = (process.env.QA_AI_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allowed.includes("*") && !allowed.includes(userId)) return { ok: false, status: 403, error: "Model selection is only available for QA users." };
  if (choice === "ds" && allowed.includes("*")) return { ok: false, status: 403, error: "ai=ds needs an explicit QA user id (a wildcard does not enable the paid route)." };
  if (choice === "ds" && process.env.QA_ALLOW_PAID !== "1") return { ok: false, status: 403, error: "ai=ds uses a paid route and is disabled (QA_ALLOW_PAID is not set)." };
  const wanted = llmRoutes({ paid: choice === "ds" }).filter(r => (choice === "g" ? r.name === "gemini" : r.name === "refuseless"));
  if (!wanted.length) return { ok: false, status: 503, error: `The ${choice === "g" ? "Gemini" : "DeepSeek"} route is not configured on this server.` };
  return { ok: true, routes: wanted, strict: true, choice };
}

// Gemini 3 needs `thought_signature` round-tripped on tool calls; the OpenAI-compatible endpoint drops it (HTTP 400), so Gemini uses its native provider.
export function languageModel(route: LlmRoute) {
  if (route.name === "gemini") return createGoogleGenerativeAI({ apiKey: route.apiKey })(route.model);
  return createOpenAICompatible({ name: route.name, apiKey: route.apiKey, baseURL: route.baseURL })(route.model);
}

export type TraceEntry = { stage: string; route: string; model: string; ok: boolean; status?: number | string; ms: number; note?: string };
export class ModelTrace {
  entries: TraceEntry[] = [];
  constructor(readonly choice: string, readonly strict: boolean) {}
  record(stage: string, route: LlmRoute, ok: boolean, started: number, error?: unknown) {
    const e = error as { statusCode?: number; status?: number; message?: string } | undefined;
    const entry: TraceEntry = { stage, route: route.name, model: route.model, ok, ms: Date.now() - started, ...(error ? { status: e?.statusCode ?? e?.status ?? "error", note: errCode(e?.message, e?.statusCode ?? e?.status) } : {}) };
    this.entries.push(entry);
    console.info("[ai-trace]", JSON.stringify({ choice: this.choice, strict: this.strict, ...entry }));
  }
  /** The route that actually produced output last, and whether any earlier route failed first (fallback). */
  summary() {
    const okEntries = this.entries.filter(x => x.ok);
    const used = okEntries[okEntries.length - 1];
    const fellBack = used ? this.entries.some(x => !x.ok && (x.route !== used.route || x.model !== used.model)) : false;
    return { choice: this.choice, strict: this.strict, used: used ? `${used.route}/${used.model}` : null, fellBack, paid: this.entries.some(x => x.ok && x.route === "refuseless"), attempts: this.entries };
  }
}
