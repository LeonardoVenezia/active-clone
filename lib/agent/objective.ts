import { generateText, type LanguageModel } from "ai";

export type Standing = "wanted" | "withdrawn" | "unclear";

/**
 * Semantic arbiter for "is this deliverable still wanted?". It reads ONLY the user's own messages, in order, verbatim (no summary, no agent text).
 * A regex finds candidates elsewhere; this decides whether a candidate still stands. Any failure returns "unclear", which never blocks the build
 * and never silently drops the goal: the agent is told it is unresolved.
 */
export async function judgeStanding(model: LanguageModel, userMessages: string[], kinds: string[], signal?: AbortSignal): Promise<Record<string, Standing>> {
  const fallback = Object.fromEntries(kinds.map(k => [k, "unclear" as Standing]));
  if (!kinds.length) return {};
  const convo = userMessages.map((m, i) => `${i + 1}. ${m.slice(0, 1200)}`).join("\n");
  try {
    const r = await generateText({ model, maxRetries: 0, abortSignal: signal, temperature: 0, maxOutputTokens: 300,
      system: "You classify what a user wants, from the user's own messages only (numbered, oldest first). Output ONLY compact JSON mapping each requested kind to one of: \"wanted\", \"withdrawn\", \"unclear\". \"withdrawn\" only if, by the LAST message, the user clearly dropped or replaced it (e.g. said to leave it out, or asked for something else instead). A question about cost or feasibility, a hypothetical, an example, a request for information about it, or a withdrawal the user later reversed is NOT a withdrawal. \"wanted\" if they asked to create it and never clearly dropped it. Use \"unclear\" when you cannot tell.",
      prompt: `Kinds: ${kinds.join(", ")}\nUser messages:\n${convo}\n\nJSON:` });
    const m = r.text.match(/\{[\s\S]*\}/); if (!m) return fallback;
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const out: Record<string, Standing> = {};
    for (const k of kinds) { const v = String(parsed[k] ?? "").toLowerCase(); out[k] = v === "wanted" || v === "withdrawn" ? v : "unclear"; }
    return out;
  } catch { return fallback; }
}
