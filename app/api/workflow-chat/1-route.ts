import { llmRoutes } from "@/lib/free-models";
import { describeToolkit } from "@/lib/connectors/generic";
import { myConnections } from "@/lib/connectors";
import { PRESETS } from "@/lib/connectors/presets";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { append, history, recentUserMessages, validWorkflowId } from "@/lib/workflow-chat";
export const maxDuration = 60;
const ORIGINS = ["https://active-clone.vercel.app", "https://active-clone-leonardo-venezias-projects.vercel.app"];
async function user(r: Request) { const s = await auth.api.getSession({ headers: r.headers }); return s?.user && !s.user.isAnonymous ? s.user.id : null; }
type Snap = { nodes?: { id?: string; label?: string; type?: string; action?: string }[]; edges?: { source?: string; target?: string }[] };
const REQUESTED_TOOLKITS: [string, RegExp][] = [
  ["outlook", /\b(?:microsoft\s+)?outlook\b/i],
  ["gmail", /\bgmail\b/i],
  ["googlesheets", /\b(?:google\s+)?sheets\b/i],
];
const CONNECT_INTENT = /\b(?:connect|link|sign\s*in|log\s*in|authorize|authenticate|conect\w*|vincul\w*|inici\w+\s+sesion)\b/i;
const CONNECTOR_SLUG_ALIASES: Record<string, string> = { microsoft_outlook: "outlook", google_sheets: "googlesheets" };
function describe(s: Snap | undefined) {
  const nodes = (s?.nodes || []).slice(0, 40);
  if (!nodes.length) return "The canvas is empty.";
  const n = nodes.map(x => `- ${String(x.id).slice(0, 24)}: ${String(x.label || x.action || x.type || "step").slice(0, 60)} (${String(x.type || "").slice(0, 12)})`).join("\n");
  const e = (s?.edges || []).slice(0, 60).map(x => `${String(x.source).slice(0, 24)} -> ${String(x.target).slice(0, 24)}`).join(", ");
  return `Current canvas steps:\n${n}\nConnections between steps: ${e || "none"}`;
}
const SYSTEM = `You are Active-clone's friendly workflow assistant for people who may be new to automation. Speak the user's language in plain, short sentences. Help them plan, understand and build workflows on the canvas.
First understand the desired outcome. Ask one focused question at a time when the trigger, apps, who/what to act on, or result is unclear. Do not guess about important details. Explain what each step does in everyday language and distinguish a draft on the canvas from an activated workflow that will actually run.
When the user clearly asks to build or change the canvas, describe the exact plan briefly and end with the exact marker [[BUILD: one plain sentence describing the requested canvas change]]. This marker only offers the user a Build this on the canvas button; never claim the change is done. When an app is required, use the connection-status block below: never ask the user whether they already connected an account. If its status is missing or needs_attention, include a separate exact marker [[CONNECT: toolkit_slug]] using the lowercase slug shown in the status block; the app will show a connection card. If status is active, do not ask to connect it; if pending, say the connection is still in progress and do not request another one. If connection status could not be checked, say that plainly and do not guess. If both connection and a canvas build are needed, put the CONNECT marker on the line before the final BUILD marker, with no text after the BUILD marker. Never mention or promise a link, button, or click instruction in prose; only the app can show a connection card. Never tell users to log out. Review permissions with the user before they approve. Never ask for passwords, API keys or verification codes in chat. Do not invent available apps, actions, permissions, run status or results. For Composio apps, use only exact toolkit and action slugs supplied from the live catalog by the canvas builder; never guess an action slug or schema.
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
    const userAuthoredText = [...past.filter(m => m.role === "user").map(m => m.content), text].join("\n");
    const requestedToolkits = REQUESTED_TOOLKITS.filter(([slug, pattern]) => !!PRESETS[slug] && pattern.test(userAuthoredText)).map(([slug]) => slug);
    let connectionStatusContext = "Connection status could not be checked. Do not guess or ask the user to remember; say you could not verify.";
    const connectionStatuses: Record<string, "active" | "pending" | "needs_attention" | "missing"> = {};
    if (requestedToolkits.length) {
      try {
        const connections = await myConnections(id, requestedToolkits);
        for (const slug of requestedToolkits) {
          const entries = connections[slug] ?? [];
          connectionStatuses[slug] = entries.some(c => c.status === "active") ? "active"
            : entries.some(c => c.status === "pending") ? "pending"
            : entries.some(c => c.status === "needs_attention" || c.status === "failed") ? "needs_attention"
            : "missing";
        }
        connectionStatusContext = `Verified connection status for apps mentioned by the user (do not ask the user to guess):\n${requestedToolkits.map(slug => `- ${slug}: ${connectionStatuses[slug]}`).join("\n")}`;
      } catch (e) {
        console.error("[workflow-chat] connection status lookup failed", e instanceof Error ? e.message : "unknown");
      }
    } else {
      connectionStatusContext = "No supported connection toolkit has been identified in the user's messages yet.";
    }
    const messages = [{ role: "system" as const, content: `${SYSTEM}\n\n${connectionStatusContext}\n\n${describe(b.snapshot)}` }, ...past.map(m => ({ role: m.role, content: m.content })), { role: "user" as const, content: text }];
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
      const rawSlug = cm[1].toLowerCase();
      const slug = CONNECTOR_SLUG_ALIASES[rawSlug] ?? rawSlug;
      if (PRESETS[slug]) {
        const status = connectionStatuses[slug];
        if (status === "missing" || status === "needs_attention") connect = { ...PRESETS[slug], generic: false };
      } else { const t = await describeToolkit(slug).catch(() => null); if (t && ((t.oauth && t.managed) || t.keyScheme)) connect = { toolkitId: t.id, title: t.name, grants: [], doesNotGrant: [], consentHint: "", generic: true, apiKey: !t.managed }; }
    }
    if (cm) reply = reply.replace(/\s*\[{1,2}CONNECT[^\]]*\]{1,2}\s*/gi, "\n").trim() || "To continue I need you to connect that account. Check the permissions below.";
    if (!cm && CONNECT_INTENT.test(reply)) {
      const missing = requestedToolkits.filter(slug => connectionStatuses[slug] === "missing" || connectionStatuses[slug] === "needs_attention");
      const mentioned = missing.filter(slug => REQUESTED_TOOLKITS.find(([id]) => id === slug)?.[1].test(reply));
      const candidates = mentioned.length ? mentioned : missing;
      if (candidates.length === 1 && PRESETS[candidates[0]]) {
        const preset = PRESETS[candidates[0]];
        connect = { ...preset, generic: false };
        const buildMarker = reply.match(/\[\[BUILD:\s*[\s\S]{3,600}?\]\]\s*$/)?.[0];
        reply = `Para continuar, conecta ${preset.title} con la tarjeta que aparece aquí. Revisa los permisos antes de aceptar.${buildMarker ? `
${buildMarker}` : ""}`;
      }
    }
    const m = reply.match(/\[\[BUILD:\s*([\s\S]{3,600}?)\]\]\s*$/);
    const build = m ? m[1].trim() : null;
    const shown = m ? reply.slice(0, m.index).trim() || "On it." : reply;
    await append(id, b.workflowId, "assistant", shown);
    return NextResponse.json({ reply: shown, build, connect });
  } catch { return NextResponse.json({ error: "Something went wrong. Your message was kept; try again." }, { status: 503 }); }
}

