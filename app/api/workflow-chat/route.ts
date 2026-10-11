import { llmRoutes } from "@/lib/free-models";
import { describeToolkit } from "@/lib/connectors/generic";
import { PRESETS } from "@/lib/connectors/presets";
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
const SYSTEM = `You are Active-clone's friendly workflow assistant for people who may be new to automation. Speak the user's language in plain, short sentences. Help them plan, understand and build workflows on the canvas.
First understand the desired outcome. Ask one focused question at a time when the trigger, apps, who/what to act on, or result is unclear. Do not guess about important details. Explain what each step does in everyday language and distinguish a draft on the canvas from an activated workflow that will actually run.
When the user clearly asks to build or change the canvas, describe the exact plan briefly and use the BUILD marker. When a required app is not connected, explain why it is needed and request that app connection using the CONNECT marker so the app can show the approval card. Guide onboarding one step at a time and verify before claiming a connection or change succeeded. Never tell users to log out to connect; ask them to sign in/connect to the right app account and review the permissions shown. Never ask for passwords, API keys or verification codes in chat. Do not invent available apps, actions, permissions, run status or results. For Composio apps, use only exact toolkit and action slugs supplied from the live catalog by the canvas builder; never guess an action slug or schema.
Available canvas actions include the built-in steps described to the workflow builder and Run Composio Action for connected Composio apps. If unsure whether a tool is available, ask instead of pretending.`
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
    const messages = [{ role: "system" as const, content: `${SYSTEM}\n\n${describe(b.snapshot)}` }, ...past.map(m => ({ role: m.role, content: m.content })), { role: "user" as const, content: text }];
    let reply = "";
    for (const r of llmRoutes()) {
      if (reply) break;
      try {
        const client = new OpenAI({ apiKey: r.apiKey, baseURL: r.baseURL, maxRetries: 0, timeout: 10_000 });
        reply = (await client.chat.completions.create({ model: r.model, max_tokens: r.maxTokens, messages })).choices[0]?.message?.content?.trim() || "";
        if (!reply) console.error("[workflow-chat] empty reply from", r.name, r.model);
      } catch (e) { console.error("[workflow-chat] model failed", r.name, r.model, (e as { status?: number })?.status); }
    }
    if (!reply) return NextResponse.json({ error: "The free AI model didn't answer (it may be busy). Your message was kept; send it again in a moment." }, { status: 502 });
    if (/\[\[BUILD:\s*one plain sentence|Composio toolkit slug in lowercase|one extra final line/i.test(reply)) reply = "I got confused there. Could you say that again in one sentence?";
    reply = reply.replace(/<\|[^|>]{1,40}\|>(\s*\[\s*\])?/g, "").trim();
    const cm = reply.match(/\[{1,2}CONNECT\s*[:(=]?\s*(?:slug\s*=\s*)?['"]?([a-z0-9_]{1,40})['"]?\s*\)?\s*\]{1,2}/i);
    let connect: Record<string, unknown> | null = null;
    if (cm) {
      const slug = cm[1].toLowerCase();
      if (PRESETS[slug]) connect = { ...PRESETS[slug], generic: false };
      else { const t = await describeToolkit(slug).catch(() => null); if (t && ((t.oauth && t.managed) || t.keyScheme)) connect = { toolkitId: t.id, title: t.name, grants: [], doesNotGrant: [], consentHint: "", generic: true, apiKey: !t.managed }; }
    }
    if (cm) reply = reply.replace(/\s*\[{1,2}CONNECT[^\]]*\]{1,2}\s*/gi, "\n").trim() || "To continue I need you to connect that account. Check the permissions below.";
    const m = reply.match(/\[\[BUILD:\s*([\s\S]{3,600}?)\]\]\s*$/);
    const build = m ? m[1].trim() : null;
    const shown = m ? reply.slice(0, m.index).trim() || "On it." : reply;
    await append(id, b.workflowId, "assistant", shown);
    return NextResponse.json({ reply: shown, build, connect });
  } catch { return NextResponse.json({ error: "Something went wrong. Your message was kept; try again." }, { status: 503 }); }
}
