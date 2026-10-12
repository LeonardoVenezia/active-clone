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
First understand the desired outcome. Ask one focused question at a time when the trigger, apps, who/what to act on, or result is unclear. Do not guess about important details. Explain what each step does in everyday language and distinguish a draft on the canvas from an activated workflow that will actually run. When the user explicitly asks you to create/build a plan, include the exact [[BUILD: ...]] marker and do not just say “On it.” A short acknowledgment like “ok” alone is not permission to build.
When the user clearly asks to build or change the canvas, describe the exact plan briefly and end with the exact marker [[BUILD: one plain sentence describing the requested canvas change]]. This marker can trigger the build automatically after the user explicitly asks you to create/build it or confirms the proposed plan. Never claim the change is done before the build succeeds. When an app is required, use the connection-status block below: never ask the user whether they already connected an account. If status is not_connected, include [[CONNECT: toolkit_slug]] using the exact lowercase slug from the status block. If status is needs_attention, explain that the existing connection needs reviewed permissions and include [[CONNECT: toolkit_slug]] to reconnect. If status is connected, do not ask to connect it. If status is pending, say it is still finishing. If status is check_failed, say you could not verify and offer to retry; never include CONNECT. If both connection and build are needed, put CONNECT before the final BUILD marker. Never mention or promise a link, button, or click instruction in prose; only the app can show a connection card. Never tell users to log out. Review permissions with the user before they approve. Never ask for passwords, API keys or verification codes in chat. Do not invent available apps, actions, permissions, run status or results. For Composio apps, use only exact toolkit and action slugs supplied from the live catalog by the canvas builder; never guess an action slug or schema.
Available canvas actions include the built-in steps described to the workflow builder and Run Composio Action for connected Composio apps. If unsure whether a tool is available, ask instead of pretending.`;
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
  if (!llmRoutes().length) return NextResponse.json({ error: "The chat model is not configured." }, { status: 503 });
  try {
    if ((await recentUserMessages(id)) >= 60) return NextResponse.json({ error: "You've sent a lot of messages this hour. Try again in a bit." }, { status: 429 });
    const past = await history(id, b.workflowId, 20);
    await append(id, b.workflowId, "user", text);
    const recentIntent = [...past.filter(m => m.role === "user").slice(-2).map(m => m.content), text].join("\n");
    const recentAssistantText = past.filter(m => m.role === "assistant").slice(-4).map(m => m.content).join("\n");
    const explicitBuildIntent = /^\s*(?:(?:please|por favor)\s+)?(?:build|create|make it|put it on (?:the )?canvas|do it|go ahead|create it|arm[aá]lo|crea(?:lo|la|r)|hacelo|hazlo)\b/i.test(text) || /\b(?:por favor|please)\s+(?:cre[aá]|arm[aá]|constru[ií]|hac[eé]|build|create|make)/i.test(text) || /\bno\s+(?:veo|ves|est[aá]s|estas)\b[^.?!]{0,60}\b(?:cre|constru|arm|lienzo|canvas)/i.test(text) || /\b(?:cre[aá]lo|cre[aá]la|arm[aá]lo|hacelo|hazlo)\b/i.test(text);
    const recentlyConfirmedPlan = /\b(?:plan|flow|workflow|flujo|borrador)\b/i.test(recentAssistantText) && /\b(?:yes|yeah|correct|perfect|exactly|that works|sí|si|perfecto|exacto|dale|así)\b/i.test(text);
    const requestedToolkits = REQUESTED_TOOLKITS.filter(([slug, pattern]) => !!PRESETS[slug] && pattern.test(recentIntent)).map(([slug]) => slug);
    let connectionStatusContext = "No supported connection toolkit was mentioned in the recent user intent.";
    const connectionStatuses: Record<string, "connected" | "pending" | "needs_attention" | "not_connected" | "check_failed"> = {};
    if (requestedToolkits.length) {
      const results = await Promise.all(requestedToolkits.map(async slug => {
        try { return { slug, entries: (await myConnections(id, [slug]))[slug] ?? [], error: null as unknown }; }
        catch (error) { console.error(`[workflow-chat] connection status lookup failed for ${slug}:`, error instanceof Error ? error.message : "unknown"); return { slug, entries: [], error }; }
      }));
      for (const { slug, entries, error } of results) {
        connectionStatuses[slug] = error ? "check_failed" : entries.some(c => c.status === "active") ? "connected" : entries.some(c => c.status === "pending") ? "pending" : entries.some(c => c.status === "needs_attention" || c.status === "failed") ? "needs_attention" : "not_connected";
      }
      connectionStatusContext = `Verified connection status for apps mentioned in recent user intent (do not ask the user to guess):\n${requestedToolkits.map(slug => `- ${slug}: ${connectionStatuses[slug]}`).join("\n")}`;
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
        if (status === "not_connected" || status === "needs_attention") connect = { ...PRESETS[slug], generic: false, needsAttention: status === "needs_attention" };
      } else { const t = await describeToolkit(slug).catch(() => null); if (t && ((t.oauth && t.managed) || t.keyScheme)) connect = { toolkitId: t.id, title: t.name, grants: [], doesNotGrant: [], consentHint: "", generic: true, apiKey: !t.managed }; }
    }
    if (cm) reply = reply.replace(/\s*\[{1,2}CONNECT[^\]]*\]{1,2}\s*/gi, "\n").trim() || "To continue I need you to connect that account. Check the permissions below.";
    if (cm) { const slug = CONNECTOR_SLUG_ALIASES[cm[1].toLowerCase()] ?? cm[1].toLowerCase(); if (PRESETS[slug] && !["not_connected", "needs_attention"].includes(connectionStatuses[slug])) { connect = null; reply = connectionStatuses[slug] === "check_failed" ? "No pude verificar el estado de conexión de esa app. Reintentá en un momento; no hace falta conectarla otra vez todavía." : connectionStatuses[slug] === "pending" ? "La conexión de esa app todavía está terminando." : "La conexión de esa app ya está activa. Podemos seguir sin conectarla otra vez."; } }
    if (!cm && (explicitBuildIntent || recentlyConfirmedPlan)) {
      const instruction = [...past.filter(m => m.role === "assistant").slice(-4).map(m => m.content), text].join("\n").replace(/[\r\n]+/g, " ").slice(-550);
      reply = `Voy a preparar el borrador en el lienzo.\n[[BUILD: ${instruction}]]`;
    }
    if (!cm && CONNECT_INTENT.test(reply)) {
      const unchecked = requestedToolkits.find(slug => ["check_failed", "pending"].includes(connectionStatuses[slug]) && REQUESTED_TOOLKITS.find(([id]) => id === slug)?.[1].test(reply));
      if (unchecked) { connect = null; reply = connectionStatuses[unchecked] === "check_failed" ? "No pude verificar el estado de conexión de esa app. Reintentá en un momento; no hace falta conectarla otra vez todavía." : "La conexión de esa app todavía está terminando. Probá de nuevo en un momento."; }
      const candidates = requestedToolkits.filter(slug => ["not_connected", "needs_attention"].includes(connectionStatuses[slug]) && REQUESTED_TOOLKITS.find(([id]) => id === slug)?.[1].test(reply));
      if (candidates.length === 1 && PRESETS[candidates[0]]) {
        const preset = PRESETS[candidates[0]];
        const needsAttention = connectionStatuses[candidates[0]] === "needs_attention";
        connect = { ...preset, generic: false, needsAttention };
        const buildMarker = reply.match(/\[\[BUILD:\s*[\s\S]{3,600}?\]\]\s*$/)?.[0];
        reply = `${needsAttention ? `Hay una conexión de ${preset.title}, pero necesita permisos revisados. Reconéctala para seguir.` : `Para continuar, conecta ${preset.title} con la tarjeta que aparece aquí. Revisa los permisos antes de aceptar.`}${buildMarker ? `\n${buildMarker}` : ""}`;
      } else if (requestedToolkits.some(slug => connectionStatuses[slug] === "connected" && REQUESTED_TOOLKITS.find(([id]) => id === slug)?.[1].test(reply))) {
        reply = "La conexión de esa app ya está activa. Podemos seguir sin conectarla otra vez.";
      }
    }
    if (/\b(?:on it|i(?:'|’)ll (?:do|create|build)\b|i am going to (?:create|build)|voy a (?:hacerlo|crearlo|armarlo|crear|armar|preparar|construir|hacer))\b/i.test(reply) && !/\[\[BUILD:/i.test(reply) && !connect) {
      reply = "No pude iniciar el borrador todavía. Decime qué flujo querés que arme y lo intento de nuevo.";
    }
    const m = reply.match(/\[\[BUILD:\s*([\s\S]{3,600}?)\]\]\s*$/);
    const build = m ? m[1].trim() : null;
    const shown = m ? reply.slice(0, m.index).trim() || "On it." : reply;
    await append(id, b.workflowId, "assistant", shown);
    return NextResponse.json({ reply: shown, build, connect });
  } catch { return NextResponse.json({ error: "Something went wrong. Your message was kept; try again." }, { status: 503 }); }
}
