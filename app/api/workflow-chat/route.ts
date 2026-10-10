import OpenAI from "openai";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { append, history, recentUserMessages, validWorkflowId } from "@/lib/workflow-chat";
export const maxDuration = 60;
const ORIGINS = ["https://active-clone.vercel.app", "https://active-clone-leonardo-venezias-projects.vercel.app"];
async function user(r: Request) { const s = await auth.api.getSession({ headers: r.headers }); return s?.user && !s.user.isAnonymous ? s.user.id : null; }
type Snap = { nodes?: { id?: string; label?: string; type?: string; action?: string }[]; edges?: { source?: string; target?: string }[] };
function describe(s: Snap | undefined) {
  const nodes = (s?.nodes || []).slice(0, 40);
  if (!nodes.length) return "The canvas is empty.";
  const n = nodes.map(x => `- ${String(x.id).slice(0, 24)}: ${String(x.label || x.action || x.type || "step").slice(0, 60)} (${String(x.type || "").slice(0, 12)})`).join("\n");
  const e = (s?.edges || []).slice(0, 60).map(x => `${String(x.source).slice(0, 24)} -> ${String(x.target).slice(0, 24)}`).join(", ");
  return `Current canvas steps:\n${n}\nConnections between steps: ${e || "none"}`;
}
const SYSTEM = `You are the assistant built into Active-clone, a visual automation board. The user is not technical, so use plain words, be warm and brief (at most 5 short sentences), and reply in the user's language.
You help them think through what they want to automate: ask one clarifying question at a time when something important is missing (which apps, what triggers it, what should happen), suggest simple ideas, and explain what the board shows.
Right now you can only talk. You cannot yet change the canvas, connect apps or run anything, so never say you did, and never claim a step was added. If they ask you to build or change something, say that building on the canvas is coming next, and summarize the plan you would build so they can confirm it.
Never ask for passwords or API keys in the chat.`;
export async function GET(r: Request) {
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const w = new URL(r.url).searchParams.get("workflowId");
  if (!validWorkflowId(w)) return NextResponse.json({ error: "Bad workflow." }, { status: 400 });
  try { return NextResponse.json({ messages: await history(id, w) }); } catch { return NextResponse.json({ error: "Could not load the conversation. Try again." }, { status: 503 }); }
}
export async function POST(r: Request) {
  const origin = r.headers.get("origin");
  if (!origin || !ORIGINS.includes(origin) || new URL(r.url).origin !== origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let b: { workflowId?: unknown; message?: unknown; snapshot?: Snap };
  try { b = await r.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  if (!validWorkflowId(b.workflowId)) return NextResponse.json({ error: "Bad workflow." }, { status: 400 });
  const text = typeof b.message === "string" ? b.message.trim().slice(0, 2000) : "";
  if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "The chat model is not configured." }, { status: 503 });
  try {
    if ((await recentUserMessages(id)) >= 60) return NextResponse.json({ error: "You've sent a lot of messages this hour. Try again in a bit." }, { status: 429 });
    const past = await history(id, b.workflowId, 20);
    await append(id, b.workflowId, "user", text);
    const client = new OpenAI({ apiKey: key, baseURL: "https://openrouter.ai/api/v1", maxRetries: 0, timeout: 45_000 });
    const messages = [{ role: "system" as const, content: `${SYSTEM}\n\n${describe(b.snapshot)}` }, ...past.map(m => ({ role: m.role, content: m.content })), { role: "user" as const, content: text }];
    let reply = "";
    for (let i = 0; i < 2 && !reply; i++) {
      try { reply = (await client.chat.completions.create({ model: "openrouter/free", max_tokens: 400, messages })).choices[0]?.message?.content?.trim() || ""; } catch { /* retry once */ }
    }
    if (!reply) return NextResponse.json({ error: "The free AI model didn't answer (it may be busy). Your message was kept; send it again in a moment." }, { status: 502 });
    await append(id, b.workflowId, "assistant", reply);
    return NextResponse.json({ reply });
  } catch { return NextResponse.json({ error: "Something went wrong. Your message was kept; try again." }, { status: 503 }); }
}
