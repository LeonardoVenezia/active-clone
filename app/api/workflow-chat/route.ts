import { llmRoutes } from "@/lib/free-models";
import { selectRoutes } from "@/lib/model-select";
import { unifiedResponse } from "./unified";
import { describeToolkit } from "@/lib/connectors/generic";
import { myConnections } from "@/lib/connectors";
import { PRESETS } from "@/lib/connectors/presets";
import { listNativeConnections, nativeChatContext, nativeOAuthApp } from "@/lib/integrations/directory";
import { createUIMessageStream, createUIMessageStreamResponse, streamText } from "ai";
import { z } from "zod";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowTemplates } from "@/lib/db/schema";
import { getOrgContext } from "@/lib/org-utils";
import { append, history, recentUserMessages, validWorkflowId } from "@/lib/workflow-chat";
export const maxDuration = 300;
const ORIGINS = ["https://active-clone.vercel.app", "https://active-clone-leonardo-venezias-projects.vercel.app"];
async function user(r: Request) { const s = await auth.api.getSession({ headers: r.headers }); return s?.user && !s.user.isAnonymous ? s.user.id : null; }
type Snap = { nodes?: { id?: string; label?: string; type?: string; action?: string }[]; edges?: { source?: string; target?: string }[] };
const REQUESTED_TOOLKITS: [string, RegExp][] = [
  ["outlook", /\b(?:microsoft\s+)?outlook\b/i],
  ["gmail", /\bgmail\b/i],
  ["googlesheets", /\b(?:google\s+)?sheets\b/i],
  ["mercadopago", /\bmercado\s*pago\b/i],
  ["mercadolibre", /\bmercado\s*libre\b/i],
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
const SYSTEM = `You are Active-clone's workflow manager. You chat like a capable colleague who happens to run an automation board: natural, warm, direct. The user is a non-technical owner who does not want to do the work - you do it, they stay in charge. Always reply in the exact language the user writes in - never switch languages mid-conversation. Plain, short sentences. No jargon.
HOW TO CARRY THE CONVERSATION:
- Conversation first, ceremony never. React to what the user says, think briefly out loud, propose when you have something worth proposing. Never sound like a setup wizard or a phone menu: no rigid step-by-step scripts, no interrogation rounds, no repeating the user's words back as a checklist unless a summary genuinely helps.
- Use your own judgment about what to do next. Ask when something essential is missing - one thing at a time, woven naturally into the conversation. Propose a short plan in your own words when the picture is complete enough. Build when the user clearly wants it built; when in doubt, show the short plan and ask something like "Lo armo asi?" in whatever words feel natural.
- You have agency over the board and the details. Decide what the user delegated or does not care about (names, intervals, columns, reasonable defaults), say what you picked in passing, and move on. DELEGATED CHOICES: when the user leaves a detail to you ("crea vos", "elegi vos", "un nombre razonable", "como quieras", "lo que digas", "decidilo", "your choice" - including a form's "Crealo por mi" button), that detail is settled: pick a short sensible value yourself, mention your pick, and never ask for it again, neither in chat nor with a form.
- Never ask again for something the user already gave you or delegated earlier in the conversation. Never re-offer anything they already declined (a template, the "Email to sheet" flow, an option): a "no" is final unless the user brings it back.
- Collect what each step genuinely needs before building: which spreadsheet (name or link) and which columns, or a new one; which Notion page or database; which Slack channel; which address or filter. Never ask for values an earlier step produces (order IDs, payment references, totals, statuses, buyer names, search results): those wire automatically from the previous step's result. Ask only for what the user truly knows. A single quick detail can simply be asked in conversation; when several concrete details are needed at once, a form card is smoother: write one short sentence of context and end with the marker [[FORM: short title | field label | field label | create]], where each field label is what the user must fill in and the final token "create" appears only when the app can create that resource for them (for example a new spreadsheet), which gives the user a "create it for me" option. Never combine FORM with BUILD or CONNECT in the same reply.
CUSTOM APIS: when the user wants the flow to call their own API or endpoint (an HTTP Request step), besides the URL ask them to paste a sample JSON response of that endpoint ("pegame un ejemplo de la respuesta JSON que devuelve"). With that sample the builder wires real field names instead of guessing. If they do not have one, say the flow will use generic fields they may need to adjust after a first run.
MAIL TRIGGERS: for mail the app has a ready-made "Email to sheet" flow in the Flows page (menu "Flows") that reacts to real incoming mail instantly. When the user wants something to happen when a mail arrives (for example saving mails in a spreadsheet), offer that flow ONCE in one plain sentence and ask if they want to use it; if they accept, point them to the Flows page and do NOT add a BUILD marker. If they decline or ask you to build it yourself, never offer it again: build the flow on the canvas as a Schedule trigger that checks for new mail every 15 minutes (Schedule -> fetch recent emails with the mail app's fetch/list action -> a Loop that runs the requested steps once per message), and mention in one short sentence that on the canvas it checks mail every 15 minutes instead of instantly. Never build a Webhook node for mail and never claim the canvas version is instant.
DRAFT MODE: when the user explicitly declines to connect accounts for now (a mockup, demo, draft, "maqueta", "borrador sin conectar", "sin conectar nada", "sin ejecutar nada real"), do NOT insist on connecting and NEVER emit a [[CONNECT: ...]] marker, no matter which app a step uses. Plan and build anyway with clearly-marked example values, and mention in one short sentence which steps will need a real connection later (the connection is requested only when the user runs the workflow for real). The user is in charge; a draft on the canvas costs nothing.
SAVED TEMPLATES: the block below lists flows the user already saved as templates. When the user's request clearly matches one, offer it in ONE short sentence with its name and what it does, and end your reply with the exact marker [[TEMPLATE: its_id]] using only an id from that list, never an invented one. If they say no or ask for something different, continue the normal flow. Never combine TEMPLATE with BUILD, FORM or CONNECT in the same reply. If the list says there are none, never mention templates. When the user then accepts the offered template - any conversational yes, including a conditional one like "si pero cambia X" - end your reply with the exact marker [[TEMPLATE-IMPORT: its_id]] (again only an id from the list) so the app imports it into the canvas right away; if the same message asked for adjustments, ALSO put [[BUILD: those exact adjustments on top of the imported template]] AFTER the import marker. If they decline or ask to build from scratch, no marker: continue the normal flow.
UNDO: when the user asks to undo or revert the last canvas change ("deshace", "volve atras", "undo", "reverti eso"), answer in ONE short sentence and end with the exact marker [[UNDO]]. The app performs the undo itself; never claim the change was undone without the marker, and never combine UNDO with BUILD, FORM, CONNECT or TEMPLATE markers in the same reply.
ACTING ON THE CANVAS: the app reads small markers at the end of your replies and performs the action itself; never mention markers, buttons, or mechanics in your prose.
- BUILD: when the user confirms a plan or directly asks for a canvas change (any yes, ok, dale, listo, or a command like crea/arma), answer in one natural sentence and end with the exact marker [[BUILD: one plain sentence with the full requested canvas change including the collected details]]. Do not ask again, do not repeat the plan. Same for edits ("saca ese nodo", "cambia la hoja"): one sentence and [[BUILD: ...]] describing exactly that change. You may add, change and remove steps yourself. The user stays the final owner and can undo.
STRICT RULES:
- Never say the flow is built, armed, ready or done ("listo", "armado", "quedo", "ya esta", "done") unless that same reply ends with the [[BUILD: ...]] marker: without the marker NOTHING changes on the canvas and the claim is a lie. When the user wants it built, the marker IS the building.
- Never announce an intention without acting. Forbidden: "voy a crear", "voy a preparar", "on it", "lo voy a hacer", "I'll build". Either include the [[BUILD: ...]] marker in the same reply, or ask the specific question you still need. Never write a reply that only promises.
- Never claim the change is done before the build succeeds. Never mention or promise a link, button, or click in prose; only the app shows connection cards.
- When an app is required, use the connection-status block below: never ask the user whether they already connected an account. If status is not_connected, include [[CONNECT: toolkit_slug]] using the exact lowercase slug from the status block. If status is needs_attention, say the existing connection needs reviewed permissions and include [[CONNECT: toolkit_slug]]. If status is connected, do not ask to connect it. If status is pending, say it is still finishing. If status is check_failed, say you could not verify and offer to retry; never include CONNECT. If both connection and build are needed, put CONNECT first and do not include BUILD until the connection exists. EXCEPTION: in DRAFT MODE never include CONNECT; build the draft with example values.
- Repeating steps per list item IS supported with a Loop step ("repetir por cada elemento"): it runs a short chain of steps once per item, up to 50 items; items that fail are marked and the run continues. When the user asks to process each item of a list (check each order, message each customer), include a Loop step in the plan: one step produces the list, the Loop repeats the per-item steps, and a final step can summarize the results. If one summary over the whole list is enough for what they asked, offer that simpler version instead, always keeping every app and step they requested.
- Distinguish a draft on the canvas from an activated workflow that really runs. Never tell users to log out. Never ask for passwords, API keys or verification codes in chat. Do not invent available apps, actions, permissions, run status or results. Mercado Pago and Mercado Libre are native apps: when their status is not_connected, include [[CONNECT: mercadopago]] or [[CONNECT: mercadolibre]] exactly; the app shows a one-click connect card for them. For Composio apps use only exact toolkit and action slugs supplied by the canvas builder from the live catalog; never guess one. If unsure whether something is possible, say so and offer the closest alternative.`;
export async function GET(r: Request) {
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const w = new URL(r.url).searchParams.get("workflowId");
  if (!validWorkflowId(w)) return NextResponse.json({ error: "Bad workflow." }, { status: 400 });
  try { return NextResponse.json({ messages: await history(id, w) }); } catch { return NextResponse.json({ error: "Could not load the conversation. Try again." }, { status: 503 }); }
}
export async function POST(r: Request) {
  const origin = r.headers.get("origin");
  const previewOk = process.env.VERCEL_ENV === "preview" && !!origin && origin.endsWith(".vercel.app");
  if (!origin || (!ORIGINS.includes(origin) && !previewOk) || new URL(r.url).origin !== origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let b: { workflowId?: unknown; message?: unknown; snapshot?: Snap; ai?: unknown; agent?: unknown; event?: unknown; canvas?: unknown };
  try { b = await r.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const bodyShape = z.object({
    workflowId: z.unknown(),
    message: z.unknown(),
    snapshot: z.object({
      nodes: z.array(z.object({ id: z.unknown().optional(), label: z.unknown().optional(), type: z.unknown().optional(), action: z.unknown().optional() })).optional(),
      edges: z.array(z.object({ source: z.unknown().optional(), target: z.unknown().optional() })).optional(),
    }).optional(),
  });
  if (!bodyShape.safeParse(b).success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (!validWorkflowId(b.workflowId)) return NextResponse.json({ error: "Bad workflow." }, { status: 400 });
  const event = b.event === "build_done" ? ("build_done" as const) : null;
  const text = typeof b.message === "string" ? b.message.trim().slice(0, 2000) : "";
  if (!text && !event) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (!llmRoutes().length) return NextResponse.json({ error: "The chat model is not configured." }, { status: 503 });
  try {
    if ((await recentUserMessages(id)) >= 60) return NextResponse.json({ error: "You've sent a lot of messages this hour. Try again in a bit." }, { status: 429 });
    const past = await history(id, b.workflowId, 20);
    if (!event) await append(id, b.workflowId, "user", text);
    const recentIntent = [...past.filter(m => m.role === "user").slice(-2).map(m => m.content), text].join("\n").replace(/\S+@\S+/g, " ");
    const recentAssistantText = past.filter(m => m.role === "assistant").slice(-4).map(m => m.content).join("\n");
    const explicitBuildIntent = /^\s*(?:(?:please|por favor)\s+)?(?:build|create|make it|put it on (?:the )?canvas|do it|go ahead|create it|arm[aá]lo|crea(?:lo|la|r)|hacelo|hazlo)\b/i.test(text) || /\b(?:por favor|please)\s+(?:cre[aá]|arm[aá]|constru[ií]|hac[eé]|build|create|make)/i.test(text) || /\bno\s+(?:veo|ves|est[aá]s|estas)\b[^.?!]{0,60}\b(?:cre|constru|arm|lienzo|canvas)/i.test(text) || /\b(?:cre[aá]lo|cre[aá]la|arm[aá]lo|hacelo|hazlo)\b/i.test(text);
    const lastAssistant = (past.filter(m => m.role === "assistant").slice(-1)[0]?.content ?? "").trim();
    const planShown = /\b(?:plan|flujo|workflow|borrador|pasos?|steps?)\b/i.test(lastAssistant) && (/\n\s*\d+[.)]/.test(lastAssistant) || /\?\s*$/.test(lastAssistant));
    const asksConfirm = /(?:lo armo|armo|construyo|creo|hago|te parece|de acuerdo|est[aá] bien|as[ií]\s*\?|listo para|confirm|shall i|should i|sound good|ready to|does this)/i.test(lastAssistant.slice(-220)) && /\?\s*$/.test(lastAssistant);
    const affirmative = /^\s*(?:s[ií]|sip|dale|ok(?:ay|s)?|okey|perfecto|listo|de acuerdo|adelante|confirmo|va|bueno|genial|joya|exacto|correcto|yes|yep|yeah|sure|go|great|that works)\b/i.test(text) && text.length < 160;
    const recentlyConfirmedPlan = planShown && asksConfirm && affirmative;
    const requestedToolkits = REQUESTED_TOOLKITS.filter(([slug, pattern]) => (!!PRESETS[slug] || !!nativeOAuthApp(slug)) && pattern.test(recentIntent)).map(([slug]) => slug);
    let connectionStatusContext = "No supported connection toolkit was mentioned in the recent user intent.";
    const connectionStatuses: Record<string, "connected" | "pending" | "needs_attention" | "not_connected" | "check_failed"> = {};
    if (requestedToolkits.length) {
      const results = await Promise.all(requestedToolkits.map(async slug => {
        try {
          if (nativeOAuthApp(slug)) {
            const native = (await listNativeConnections(id)).filter(c => c.appId === slug);
            return { slug, entries: native.map(() => ({ status: "active" })), error: null as unknown };
          }
          return { slug, entries: (await myConnections(id, [slug]))[slug] ?? [], error: null as unknown };
        }
        catch (error) { console.error(`[workflow-chat] connection status lookup failed for ${slug}:`, error instanceof Error ? error.message : "unknown"); return { slug, entries: [], error }; }
      }));
      for (const { slug, entries, error } of results) {
        connectionStatuses[slug] = error ? "check_failed" : entries.some(c => c.status === "active") ? "connected" : entries.some(c => c.status === "pending") ? "pending" : entries.some(c => c.status === "needs_attention" || c.status === "failed") ? "needs_attention" : "not_connected";
      }
      connectionStatusContext = `Verified connection status for apps mentioned in recent user intent (do not ask the user to guess):\n${requestedToolkits.map(slug => `- ${slug}: ${connectionStatuses[slug]}`).join("\n")}`;
    }
    const nativeInfo = await nativeChatContext(id).catch(() => "");
    if (nativeInfo) connectionStatusContext = `${connectionStatusContext}\n\n${nativeInfo}`;
    let templateContext = "Saved templates: none.";
    let templatesVisible: { id: string; name: string; description: string }[] = [];
    try {
      const ctx = await getOrgContext(r);
      if (ctx) {
        const visibility = ctx.activeOrganizationId
          ? or(and(eq(workflowTemplates.userId, ctx.userId), isNull(workflowTemplates.orgId)), eq(workflowTemplates.orgId, ctx.activeOrganizationId))
          : and(eq(workflowTemplates.userId, ctx.userId), isNull(workflowTemplates.orgId));
        const rows = await db.query.workflowTemplates.findMany({ where: visibility, orderBy: [desc(workflowTemplates.updatedAt)], limit: 12 });
        templatesVisible = rows.map(t => ({ id: t.id, name: String(t.name).slice(0, 80), description: String(t.description ?? "").slice(0, 160) }));
        if (templatesVisible.length) templateContext = `Saved templates the user already has (offer with [[TEMPLATE: id]] when the request matches):\n${templatesVisible.map(t => `- ${t.id}: "${t.name}" - ${t.description || "sin descripción"}`).join("\n")}`;
      }
    } catch (e) { console.error("[workflow-chat] template list failed", e instanceof Error ? e.message : "unknown"); }
    const messages = [{ role: "system" as const, content: `${SYSTEM}\n\n${connectionStatusContext}\n\n${templateContext}\n\n${describe(b.snapshot)}` }, ...past.map(m => ({ role: m.role, content: m.content })), { role: "user" as const, content: text }];
  const selection = selectRoutes(b.ai, id);
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: selection.status });
  const legacyAllowed = selection.choice !== "auto" || (process.env.QA_AI_USER_IDS ?? "").split(",").map(x => x.trim()).some(x => x === "*" || x === id);
  if (!(b.agent === "legacy" && legacyAllowed)) {
    const draft = /\b(maqueta|mockup|demo|borrador|sin\s+conectar|sin\s+ejecutar\s+nada\s+real)\b/i.test([...past.filter(m => m.role === "user").map(m => m.content), text].join("\n"));
    const canvas = b.canvas && typeof b.canvas === "object" ? { nodes: (Array.isArray((b.canvas as { nodes?: unknown }).nodes) ? (b.canvas as { nodes: unknown[] }).nodes : []).slice(0, 80), edges: (Array.isArray((b.canvas as { edges?: unknown }).edges) ? (b.canvas as { edges: unknown[] }).edges : []).slice(0, 160) } : null;
    return unifiedResponse({ userId: id, workflowId: b.workflowId as string, text, canvas, past: (await history(id, b.workflowId as string, 40)).map(m => ({ role: m.role, content: m.content })).filter((m, k, arr) => !(event === null && k === arr.length - 1 && m.role === "user" && m.content === text)), snapshotText: describe(b.snapshot), templates: templatesVisible, selection, draftMode: draft });
  }
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        try {
          const textId = "t1";
          let reply = "";
          let emitted = "";
          let buf = "";
          let started = false;
          const feed = (chunk: string): string => {
            buf += chunk;
            const idx = buf.search(/\[\[?/);
            if (idx === -1) { const out = buf; buf = ""; return out; }
            const out = buf.slice(0, idx); buf = buf.slice(idx); return out;
          };
          const push = (chunk: string) => {
            reply += chunk;
            const out = feed(chunk);
            if (out) { emitted += out; if (started) writer.write({ type: "text-delta", id: textId, delta: out }); }
          };
          for (const route of llmRoutes()) {
            if (reply) break;
            try {
              const provider = createOpenAICompatible({ name: route.name, apiKey: route.apiKey, baseURL: route.baseURL });
              const res = streamText({ model: provider(route.model), messages, maxOutputTokens: route.maxTokens, maxRetries: 0 });
              const reader = res.textStream.getReader();
              let first;
              try {
                first = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("first chunk timeout")), 10_000))]);
              } catch {
                await reader.cancel().catch(() => undefined);
                console.error("[workflow-chat] model failed (first chunk)", route.name, route.model);
                continue;
              }
              if (first.done || !first.value || !first.value.trim()) { console.error("[workflow-chat] empty reply from", route.name, route.model); continue; }
              if (!started) { writer.write({ type: "text-start", id: textId }); started = true; }
              push(first.value);
              try {
                for (;;) {
                  const next = await reader.read();
                  if (next.done) break;
                  if (next.value) push(next.value);
                }
              } catch (streamError) {
                console.error("[workflow-chat] stream error", route.name, route.model, streamError instanceof Error ? streamError.message : "unknown");
              }
              reply = reply.trim();
              if (!reply) console.error("[workflow-chat] empty reply from", route.name, route.model);
            } catch (e) { console.error("[workflow-chat] model failed", route.name, route.model, (e as { status?: number })?.status); }
          }
          if (!reply) { writer.write({ type: "data-chat-error", data: { error: "The free AI model didn't answer (it may be busy). Your message was kept; send it again in a moment." } }); return; }
          if (!started) { writer.write({ type: "text-start", id: textId }); started = true; }
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
    let undoRequested = false;
    if (/\[\[UNDO\s*\]\]/i.test(reply)) { undoRequested = true; reply = reply.replace(/\s*\[\[UNDO\s*\]\]\s*/gi, "\n").trim() || "Listo, deshago el último cambio."; }
    let templateImport: { id: string; name: string; description: string } | null = null;
    const tim = reply.match(/\[\[TEMPLATE-IMPORT:\s*([A-Za-z0-9_-]{3,64})\s*\]\]/i);
    if (tim) {
      const hit = templatesVisible.find(t => t.id === tim[1]);
      if (hit) templateImport = hit;
      reply = reply.replace(/\s*\[\[TEMPLATE-IMPORT:[^\]]*\]\]\s*/gi, "\n").trim();
    }
    let template: { id: string; name: string; description: string } | null = null;
    const tm = reply.match(/\[\[TEMPLATE:\s*([A-Za-z0-9_-]{3,64})\s*\]\]/i);
    if (tm) {
      const hit = templatesVisible.find(t => t.id === tm[1]);
      if (hit) template = hit;
      reply = reply.replace(/\s*\[\[TEMPLATE:[^\]]*\]\]\s*/gi, "\n").trim();
      if (!reply) reply = template ? `Tengo una plantilla lista: "${template.name}". ¿La importo?` : "¿Querés que te lo arme?";
    }
    const draftMode = /\b(maqueta|mockup|demo|borrador|sin\s+conectar|sin\s+ejecutar\s+nada\s+real)\b/i.test([...past.filter(m => m.role === "user").map(m => m.content), text].join("\n"));
    const cm = reply.match(/\[{1,2}CONNECT\s*[:(=]?\s*(?:slug\s*=\s*)?['"]?([a-z0-9_]{1,40})['"]?\s*\)?\s*\]{1,2}/i);
    let connect: Record<string, unknown> | null = null;
    if (cm) {
      const rawSlug = cm[1].toLowerCase();
      const slug = CONNECTOR_SLUG_ALIASES[rawSlug] ?? rawSlug;
      if (PRESETS[slug]) {
        const status = connectionStatuses[slug];
        if (status === "not_connected" || status === "needs_attention") connect = { ...PRESETS[slug], generic: false, needsAttention: status === "needs_attention" };
      } else if (nativeOAuthApp(slug)) {
        const app = nativeOAuthApp(slug);
        if (app && connectionStatuses[slug] === "not_connected") connect = { native: true, toolkitId: app.id, title: app.name, installPath: `${app.installPath}?popup=1`, grants: [], doesNotGrant: [], consentHint: "", generic: false };
      } else { const t = await describeToolkit(slug).catch(() => null); if (t && ((t.oauth && t.managed) || t.keyScheme)) connect = { toolkitId: t.id, title: t.name, grants: [], doesNotGrant: [], consentHint: "", generic: true, apiKey: !t.managed }; }
    }
    if (cm) reply = reply.replace(/\s*\[{1,2}CONNECT[^\]]*\]{1,2}\s*/gi, "\n").trim() || "To continue I need you to connect that account. Check the permissions below.";
    if (cm) { const slug = CONNECTOR_SLUG_ALIASES[cm[1].toLowerCase()] ?? cm[1].toLowerCase(); if (!PRESETS[slug] && nativeOAuthApp(slug) && connectionStatuses[slug] === "connected") connect = null; if (PRESETS[slug] && !["not_connected", "needs_attention"].includes(connectionStatuses[slug])) { connect = null; if (connectionStatuses[slug] === "check_failed") reply = "No pude verificar el estado de conexión de esa app. Reintentá en un momento; no hace falta conectarla otra vez todavía."; else if (connectionStatuses[slug] === "pending") reply = "La conexión de esa app todavía está terminando."; else if (reply === "To continue I need you to connect that account. Check the permissions below.") reply = "Esa cuenta ya está conectada, así que sigo sin pedirte nada más. Contame qué querés que haga con ella."; } }
    if (draftMode) { connect = null; if (cm && reply === "To continue I need you to connect that account. Check the permissions below.") reply = "Sigo en modo borrador: armo el paso con datos de ejemplo y la conexi\u00f3n se pide reci\u00e9n cuando lo ejecutes de verdad."; }
    if ((!cm || draftMode) && (explicitBuildIntent || recentlyConfirmedPlan)) {
      const instruction = [...past.filter(m => m.role === "assistant").slice(-4).map(m => m.content), text].join("\n").replace(/[\r\n]+/g, " ").slice(-550);
      reply = `Armando el flujo en el lienzo.\n[[BUILD: ${instruction}]]`;
    }
    if (!cm && !draftMode && CONNECT_INTENT.test(reply)) {
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
    { const bm = reply.match(/\[\[BUILD:\s*([\s\S]{3,600}?)\]\]\s*$/); const arrival = /\b(?:lleg\w*|recib\w*|arrive\w*|receiv\w*|entr\w*)\s+(?:(?:un|una|el|los|nuevo|nueva|nuevos|any|a|an|new|alg[uú]n)\s+){0,3}(?:mails?|correos?|e-?mails?)\b|\b(?:mails?|correos?|e-?mails?)\s+(?:nuevo|new|entrante|incoming)\b/i;
      // Offer the ready-made mail flow only ONCE per conversation: if it was
      // already pitched (and the user kept talking), a decline happened - let
      // the canvas build (Schedule polling version) go through instead.
      const alreadyPitched = past.some(m => m.role === "assistant" && /email to sheet|email a hoja/i.test(m.content));
      if (bm && arrival.test(`${bm[1]} ${text}`) && !alreadyPitched) { connect = null; form = null; reply = "Para mails que llegan, la app ya tiene un flujo real listo: \"Email to sheet\", en la página Flows (menú Flows). Reacciona a mails reales de verdad. El lienzo todavía no puede arrancar desde un mail nuevo, y no quiero armarte algo que parezca funcionar y no lo haga. ¿Querés usar ese flujo?"; } }
    // Completion-claim guard: a reply that announces a built flow while the
    // canvas is still empty and no BUILD marker exists leaves the user with
    // nothing. Recover by turning the claim itself into the build instruction.
    const canvasBare = (b.snapshot?.nodes ?? []).length <= 1;
    if (canvasBare && !form && !connect && !template && !templateImport && !undoRequested && !/\[\[BUILD:/i.test(reply) && /(?:listo|ya está|ya esta|ya quedó|ya quedo|armado|armé|done|built)\b[^\n]{0,160}?\b(?:flujo|workflow|maqueta|borrador|lienzo|canvas)\b/i.test(reply)) {
      const instruction = reply.replace(/^(?:listo|ya está|ya esta|ya quedó|ya quedo)[:,]?\s*/i, "").replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
      reply = `${reply}\n[[BUILD: ${instruction}]]`;
    }
    const m = reply.match(/\[\[BUILD:\s*([\s\S]{3,600}?)\]\]\s*$/);
    const build = m ? m[1].trim() : null;
    const shown = m ? reply.slice(0, m.index).trim() || "Armando el flujo en el lienzo." : reply;
    if (shown.startsWith(emitted)) {
      const restText = shown.slice(emitted.length);
      if (restText) writer.write({ type: "text-delta", id: textId, delta: restText });
      writer.write({ type: "text-end", id: textId });
    } else if (emitted.startsWith(shown)) {
      writer.write({ type: "text-end", id: textId });
    } else {
      writer.write({ type: "text-end", id: textId });
      writer.write({ type: "data-replace-text", data: { text: shown } });
    }
    await append(id, b.workflowId as string, "assistant", shown);
    writer.write({ type: "data-chat-result", data: { build, connect, form: connect || build || template || templateImport || undoRequested ? null : form, template: connect || build || templateImport || undoRequested ? null : template, templateImport: connect || undoRequested ? null : templateImport, undo: undoRequested && !connect && !build ? true : null, autoBuild: !!build && !connect && !template && !templateImport && !undoRequested && (explicitBuildIntent || recentlyConfirmedPlan) } });

        } catch {
          try { writer.write({ type: "data-chat-error", data: { error: "Something went wrong. Your message was kept; try again." } }); } catch { /* stream already closed */ }
        }
      },
    }),
  });
  } catch { return NextResponse.json({ error: "Something went wrong. Your message was kept; try again." }, { status: 503 }); }
}


// email addresses are stripped before app detection
