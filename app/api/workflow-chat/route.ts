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
const SYSTEM = `You are Active-clone's workflow manager. The user is a non-technical owner who does not want to do the work: you run the board, they approve. Speak the user's language in plain, short sentences. Never use jargon.
GUIDED PROTOCOL - always drive the conversation through these steps, one at a time:
1. UNDERSTAND: get the trigger (what starts it), the apps involved and the result wanted. Ask ONE short question only when something essential is missing.
2. CONNECT AND COLLECT: for every app in the request, follow the connection-status block below. Then collect the setup details each step needs BEFORE showing the plan. Ask for every missing detail, one question per message: Google Sheets -> which spreadsheet (name or link) and which columns, or offer to start with a new one; Notion -> which page or database; Slack -> which channel; email -> which address or filter; any other app -> the one or two details its action needs. Never skip this, never invent a detail, never say a step is configured if the user did not give it.
3. PLAN: when everything is connected and every detail is known, show the plan as a short numbered list that includes the collected details, and end with a yes/no question like "Lo armo asi?".
4. BUILD: as soon as the user confirms (any form of yes, ok, dale, listo, de acuerdo, or a direct command like creá/armá), end your reply with the exact marker [[BUILD: one plain sentence with the full requested canvas change including the collected details]]. Do not ask again, do not repeat the plan.
5. AFTER BUILD or for edits ("sacá ese nodo", "cambiá la hoja"): describe the change in one sentence and, when the user asked for a canvas change, end with [[BUILD: ...]] describing exactly that change. You may add, change and remove steps yourself. The user stays the final owner and can undo.
DETAIL FORMS: when you need 1 to 4 concrete setup details (spreadsheet name or link, Notion page, Slack channel, folder), you MUST use a form and never ask for them in plain text. Example reply: "Para guardar los datos necesito saber dónde. [[FORM: Planilla de Google Sheets | Nombre o enlace de la planilla | create]]". Write one short sentence of context and end with the marker [[FORM: short title | field label | field label | create]] where each field label is what the user must fill in; add the final token "create" only when the app can create that resource for them (for example a new spreadsheet), which gives the user a "create it for me" option. Never combine FORM with BUILD or CONNECT in the same reply.
EDITS: when the user asks to remove, rename, move or change a step ("sacá ese nodo", "cambiá la hoja"), end with [[BUILD: ...]] describing exactly that edit. If it is unclear which step they mean, ask which one by its name. You are in charge of the board: act on it, the user can undo.
STRICT RULES:
- Never announce an intention without acting. Forbidden: "voy a crear", "voy a preparar", "on it", "lo voy a hacer", "I'll build". Either include the [[BUILD: ...]] marker in the same reply, or ask the specific question you still need. Never write a reply that only promises.
- Never claim the change is done before the build succeeds. Never mention or promise a link, button, or click in prose; only the app shows connection cards.
- When an app is required, use the connection-status block below: never ask the user whether they already connected an account. If status is not_connected, include [[CONNECT: toolkit_slug]] using the exact lowercase slug from the status block. If status is needs_attention, say the existing connection needs reviewed permissions and include [[CONNECT: toolkit_slug]]. If status is connected, do not ask to connect it. If status is pending, say it is still finishing. If status is check_failed, say you could not verify and offer to retry; never include CONNECT. If both connection and build are needed, put CONNECT first and do not include BUILD until the connection exists.
- Distinguish a draft on the canvas from an activated workflow that really runs. Never tell users to log out. Never ask for passwords, API keys or verification codes in chat. Do not invent available apps, actions, permissions, run status or results. For Composio apps use only exact toolkit and action slugs supplied by the canvas builder from the live catalog; never guess one. If unsure whether something is possible, say so and offer the closest alternative.`;
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
    const recentIntent = [...past.filter(m => m.role === "user").slice(-2).map(m => m.content), text].join("\n").replace(/\S+@\S+/g, " ");
    const recentAssistantText = past.filter(m => m.role === "assistant").slice(-4).map(m => m.content).join("\n");
    const explicitBuildIntent = /^\s*(?:(?:please|por favor)\s+)?(?:build|create|make it|put it on (?:the )?canvas|do it|go ahead|create it|arm[aá]lo|crea(?:lo|la|r)|hacelo|hazlo)\b/i.test(text) || /\b(?:por favor|please)\s+(?:cre[aá]|arm[aá]|constru[ií]|hac[eé]|build|create|make)/i.test(text) || /\bno\s+(?:veo|ves|est[aá]s|estas)\b[^.?!]{0,60}\b(?:cre|constru|arm|lienzo|canvas)/i.test(text) || /\b(?:cre[aá]lo|cre[aá]la|arm[aá]lo|hacelo|hazlo)\b/i.test(text);
    const lastAssistant = (past.filter(m => m.role === "assistant").slice(-1)[0]?.content ?? "").trim();
    const planShown = /\b(?:plan|flujo|workflow|borrador|pasos?|steps?)\b/i.test(lastAssistant) && (/\n\s*\d+[.)]/.test(lastAssistant) || /\?\s*$/.test(lastAssistant));
    const asksConfirm = /(?:lo armo|armo|construyo|creo|hago|te parece|de acuerdo|est[aá] bien|as[ií]\s*\?|listo para|confirm|shall i|should i|sound good|ready to|does this)/i.test(lastAssistant.slice(-220)) && /\?\s*$/.test(lastAssistant);
    const affirmative = /^\s*(?:s[ií]|sip|dale|ok(?:ay|s)?|okey|perfecto|listo|de acuerdo|adelante|confirmo|va|bueno|genial|joya|exacto|correcto|yes|yep|yeah|sure|go|great|that works)\b/i.test(text) && text.length < 160;
    const recentlyConfirmedPlan = planShown && asksConfirm && affirmative;
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
    let form: { title: string; fields: { key: string; label: string }[]; offerCreate: boolean } | null = null;
    const fm = reply.match(/\[\[FORM:\s*([^\]]{3,400})\]\]/i);
    if (fm) {
      const parts = fm[1].split("|").map(p => p.trim()).filter(Boolean);
      const offerCreate = parts.length > 2 && /^create$/i.test(parts[parts.length - 1]);
      const labels = (offerCreate ? parts.slice(1, -1) : parts.slice(1)).slice(0, 4);
      if (parts.length >= 2 && labels.length) form = { title: parts[0].slice(0, 80), fields: labels.map((l, i) => ({ key: `f${i}`, label: l.slice(0, 80) })), offerCreate };
      reply = reply.replace(/\s*\[\[FORM:[^\]]*\]\]\s*/gi, "\n").trim() || (form ? form.title : "Necesito un dato.");
    }
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
    if (cm) { const slug = CONNECTOR_SLUG_ALIASES[cm[1].toLowerCase()] ?? cm[1].toLowerCase(); if (PRESETS[slug] && !["not_connected", "needs_attention"].includes(connectionStatuses[slug])) { connect = null; if (connectionStatuses[slug] === "check_failed") reply = "No pude verificar el estado de conexión de esa app. Reintentá en un momento; no hace falta conectarla otra vez todavía."; else if (connectionStatuses[slug] === "pending") reply = "La conexión de esa app todavía está terminando."; else if (reply === "To continue I need you to connect that account. Check the permissions below.") reply = "Esa cuenta ya está conectada, así que sigo sin pedirte nada más. Contame qué querés que haga con ella."; } }
    if (!cm && (explicitBuildIntent || recentlyConfirmedPlan)) {
      const instruction = [...past.filter(m => m.role === "assistant").slice(-4).map(m => m.content), text].join("\n").replace(/[\r\n]+/g, " ").slice(-550);
      reply = `Armando el flujo en el lienzo.\n[[BUILD: ${instruction}]]`;
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
      } else if (false && requestedToolkits.some(slug => connectionStatuses[slug] === "connected" && REQUESTED_TOOLKITS.find(([id]) => id === slug)?.[1].test(reply))) {
        reply = "La conexión de esa app ya está activa. Podemos seguir sin conectarla otra vez.";
      }
    }
    const promisesAction = /\b(?:on it|i(?:'|’)ll|i will|i am going to|i'm going to|let me|voy a|vamos a|lo voy a|ya mismo|ahora mismo|en un momento|enseguida|en breve|me pongo a)\b[^.?!\n]{0,70}\b(?:crear|armar|preparar|construir|hacer|generar|agregar|a[nñ]adir|configurar|build|create|add|set up|make|prepare|configure|do it)/i.test(reply) || /^\s*(?:on it|ok,? on it)\W*$/i.test(reply);
    if (promisesAction && !/\[\[BUILD:/i.test(reply) && !connect) {
      reply = planShown && asksConfirm ? "Para armarlo necesito que me confirmes el plan. ¿Lo armo así?" : "Para armarlo me falta un dato. Contame qué app dispara el flujo y qué querés que pase, y lo armo.";
    }
    if (!form && !connect && !/\[\[BUILD:/i.test(reply) && /\?\s*$/.test(reply.trim()) && !(planShown && asksConfirm) && !/lo armo|te parece|de acuerdo|confirm/i.test(reply.slice(-160))) {
      if (/\b(?:planilla|hoja de c[aá]lculo|spreadsheet|google sheets|sheets)\b/i.test(reply) && /\b(?:cu[aá]l|qu[eé]|d[oó]nde|en qu[eé]|which|where)\b/i.test(reply)) form = { title: "Google Sheets", fields: [{ key: "f0", label: "Nombre o enlace de la planilla" }], offerCreate: true };
      else if (/\bnotion\b/i.test(reply) && /\b(?:cu[aá]l|qu[eé]|d[oó]nde|en qu[eé]|which|where)\b/i.test(reply)) form = { title: "Notion", fields: [{ key: "f0", label: "Página o base de datos de Notion" }], offerCreate: false };
      else if (/\bslack\b/i.test(reply) && /\b(?:canal|channel)\b/i.test(reply)) form = { title: "Slack", fields: [{ key: "f0", label: "Canal de Slack" }], offerCreate: false };
    }
    const m = reply.match(/\[\[BUILD:\s*([\s\S]{3,600}?)\]\]\s*$/);
    const build = m ? m[1].trim() : null;
    const shown = m ? reply.slice(0, m.index).trim() || "Armando el flujo en el lienzo." : reply;
    await append(id, b.workflowId, "assistant", shown);
    return NextResponse.json({ reply: shown, build, connect, form: connect || build ? null : form, autoBuild: !!build && !connect && (explicitBuildIntent || recentlyConfirmedPlan) });
  } catch { return NextResponse.json({ error: "Something went wrong. Your message was kept; try again." }, { status: 503 }); }
}


// email addresses are stripped before app detection
