// Verified free on OpenRouter's live catalog (prompt and completion price 0, supports tools and structured output).
// Tried in order; the next one is used only when the previous returns nothing. Re-check the catalog before adding or keeping entries.
export const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-26b-a4b-it:free",
  "openrouter/free",
] as const;
