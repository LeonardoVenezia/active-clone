// Providers tried in order; the next one is used only when the previous one errors (429 etc.) or returns nothing.
// OpenRouter models are the verified-free ones from its live catalog (price 0). Groq is used only when GROQ_API_KEY is set on the server.
// Refuseless is a PAID fallback (Leo's key, deepseek-v4.1-flash-fast): always LAST in the list, so it only runs when every free route failed - each call spends real balance, keep it as the last resort.
export type LlmRoute = { name: "gemini" | "openrouter" | "groq" | "refuseless"; baseURL: string; apiKey: string; model: string; maxTokens: number };
export function llmRoutes(): LlmRoute[] {
  const gemini = process.env.GEMINI_API_KEY;
  const or = process.env.OPENROUTER_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  const refuseless = process.env.REFUSELESS_API_KEY;
  const gm = gemini ? [{ name: "gemini" as const, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: gemini, model: "gemini-3.5-flash-lite", maxTokens: 4096 }] : [];
  const o = (model: string): LlmRoute[] => (or ? [{ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: or, model, maxTokens: 500 }] : []);
  const g = (model: string): LlmRoute[] => (groq ? [{ name: "groq", baseURL: "https://api.groq.com/openai/v1", apiKey: groq, model, maxTokens: 1500 }] : []);
  return [
    ...gm,
    ...o("google/gemma-4-31b-it:free"),
    ...g("openai/gpt-oss-120b"),
    ...o("nvidia/nemotron-3-super-120b-a12b:free"),
    ...o("openrouter/free"),
    ...(refuseless ? [{ name: "refuseless" as const, baseURL: "https://api.refuseless.com/v1", apiKey: refuseless, model: "deepseek-v4.1-flash-fast", maxTokens: 4096 }] : []),
  ];
}
