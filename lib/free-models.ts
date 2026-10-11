// Providers tried in order; the next one is used only when the previous one errors (429 etc.) or returns nothing.
// OpenRouter models are the verified-free ones from its live catalog (price 0). Groq is used only when GROQ_API_KEY is set on the server.
export type LlmRoute = { name: "openrouter" | "groq"; baseURL: string; apiKey: string; model: string; maxTokens: number };
export function llmRoutes(): LlmRoute[] {
  const or = process.env.OPENROUTER_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  const o = (model: string): LlmRoute[] => (or ? [{ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: or, model, maxTokens: 500 }] : []);
  const g = (model: string): LlmRoute[] => (groq ? [{ name: "groq", baseURL: "https://api.groq.com/openai/v1", apiKey: groq, model, maxTokens: 1500 }] : []);
  return [
    ...o("google/gemma-4-31b-it:free"),
    ...g("llama-3.3-70b-versatile"),
    ...g("openai/gpt-oss-120b"),
    ...o("nvidia/nemotron-3-super-120b-a12b:free"),
    ...o("openrouter/free"),
  ];
}
