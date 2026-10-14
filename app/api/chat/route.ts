import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { myConnections } from "@/lib/connectors";
import { presetFor } from "@/lib/connectors/presets";
import { neededToolkits } from "@/lib/chat-intents";
import { nativeChatContext } from "@/lib/integrations/directory";
export const maxDuration = 60;
const ORIGINS = ["https://active-clone.vercel.app", "https://active-clone-leonardo-venezias-projects.vercel.app"];
type Msg = { role: "user" | "assistant"; content: string };
const SYSTEM = "You are the assistant inside Active-clone, an automation app. Reply in the user's language, in at most 4 short sentences, plain words, no jargon. You cannot read email or edit sheets from this chat yet; never claim you did. If the user needs an app that is not connected, the app shows a connect card by itself; do not ask for passwords or keys.";
export async function POST(r: Request) {
  const origin = r.headers.get("origin");
  if (!origin || !ORIGINS.includes(origin) || new URL(r.url).origin !== origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const s = await auth.api.getSession({ headers: r.headers });
  if (!s?.user || s.user.isAnonymous) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let messages: Msg[];
  try {
    const b = await r.json();
    messages = (Array.isArray(b.messages) ? b.messages : []).slice(-12).filter((m: Msg) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string").map((m: Msg) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const last = [...messages].reverse().find(m => m.role === "user");
  if (!last) return NextResponse.json({ error: "Empty message." }, { status: 400 });
  const ids = neededToolkits(last.content);
  const mine = ids.length ? await myConnections(s.user.id, ids).catch(() => ({} as Record<string, { id: string; status: string }[]>)) : {};
  const cards = ids.map(id => {
    const p = presetFor(id);
    const conns = mine[id] || [];
    const active = conns.find(c => c.status === "active");
    return { toolkitId: id, title: p?.title || id, grants: p?.grants.map(g => g.label) || [], doesNotGrant: p?.doesNotGrant || [], consentHint: p?.consentHint || "", connected: !!active, connectionId: active?.id || conns[0]?.id || null };
  }).filter(c => presetFor(c.toolkitId));
  const nativeInfo = await nativeChatContext(s.user.id).catch(() => "");
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ reply: "The chat model is not configured yet.", cards });
  try {
    const provider = createOpenAICompatible({ name: "openrouter", apiKey: key, baseURL: "https://openrouter.ai/api/v1" });
    const extra = `${cards.length ? ` The app is showing the user a card for: ${cards.map(c => `${c.title} (${c.connected ? "already connected" : "not connected yet"})`).join(", ")}. Mention it briefly.` : ""}${nativeInfo ? `\n\n${nativeInfo}` : ""}`;
    const res = await generateText({ model: provider("openrouter/free"), maxOutputTokens: 300, system: SYSTEM + extra, messages });
    const reply = res.text.trim() || "I could not answer that. Try again.";
    return NextResponse.json({ reply, cards });
  } catch {
    return NextResponse.json({ reply: "The assistant is busy right now. Try again in a moment.", cards });
  }
}
