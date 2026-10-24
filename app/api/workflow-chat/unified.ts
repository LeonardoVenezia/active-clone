import "server-only";
import { createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { LlmRoute } from "@/lib/free-models";
import { type Selection } from "@/lib/model-select";
import { ModelTrace, languageModel } from "@/lib/model-select";
import { type ConnStatus, canonicalApp, catalogText, connectOutcome, connectionStatuses } from "@/lib/agent/capabilities";
import { append } from "@/lib/workflow-chat";

// ONE conversational agent with tools. It knows the integrations, asks only what is missing, agrees the whole flow, builds it (the
// canvas build itself stays in the validated builder module and receives the FULL conversation + agreed plan), then guides what is
// pending using real state (connections, placeholders), and keeps later edits consistent with what was agreed.
export type Review = { steps: { label: string; app?: string; aiPrompt?: string }[]; placeholders: string[] };
export type UnifiedInput = {
  userId: string; workflowId: string; text: string; event: "build_done" | null; review: Review | null;
  past: { role: "user" | "assistant"; content: string }[]; snapshotText: string; templates: { id: string; name: string; description: string }[];
  selection: Extract<Selection, { ok: true }>; draftMode: boolean;
  /** Test seams only: production never passes these. */
  deps?: { model?: (r: LlmRoute) => LanguageModel; append?: typeof append; catalogText?: typeof catalogText; connectOutcome?: typeof connectOutcome; connectionStatuses?: typeof connectionStatuses };
};
type Out = { build: string | null; connect: Record<string, unknown> | null; form: { title: string; fields: { key: string; label: string }[]; offerCreate: boolean } | null; template: { id: string; name: string; description: string } | null; templateImport: { id: string; name: string; description: string } | null; undo: boolean | null };

const PROMPT = `You are Active-clone's workflow agent: ONE conversation that understands the request, knows which integrations exist, asks only for what is genuinely missing, agrees the whole flow with the user, builds it on the canvas, and then walks them through what still needs their attention. You talk like a capable colleague: natural, warm, direct. The user is a non-technical owner who does not want to do the work - you do it, they stay in charge. Always answer in the exact language the user writes in. Plain, short sentences. No jargon.
HOW YOU WORK:
- Conversation first, ceremony never. Never sound like a setup wizard, a phone menu or a questionnaire. Do not repeat the user's request back as a plan; add value: what you would use, what is still open.
- Use the catalog below to decide what the flow needs. Decide yourself what the user delegated or does not care about (names, intervals, columns, reasonable defaults) and say what you picked in passing. When the user leaves a detail to you ("crea vos", "elegi vos", "como quieras", "your choice", a form's "Crealo por mi"), it is settled: never ask it again.
- Ask only about decisions that change the flow and that you cannot decide: which provider or app to use when several fit, which spreadsheet/page/channel/address, which filter. Judge it case by case; there is no fixed list of questions. One thing at a time, woven into the conversation. When several concrete details are needed together, use show_form. Never ask for values that an earlier step produces (order ids, totals, statuses, search results, buyer names): they are wired automatically.
- Never ask again for something already given or delegated, and never re-offer something the user declined.
- Settle the flow BEFORE building: when the picture is complete, say the plan in a few plain sentences (what triggers it, the steps in order, what the result is) and ask something natural like "Lo armo asi?". If the user directly asks for the build or already confirmed, call build_flow right away.
- When you call build_flow, "plan" must be the COMPLETE agreed flow with every concrete detail from the conversation (apps, order of steps, filters, spreadsheet names, wording, the final result the user asked for). It is the only thing the builder receives besides the conversation, so leave nothing out.
- Edits after the build: the plan already agreed stays valid. Change only what the user asked and call build_flow with the full updated plan, keeping every earlier decision unless the user changed it.
- After a build you are told what really got built and what is pending. Then, in your own words: say what you built in one sentence, ask the user to review the AI prompt you wrote when the flow has an AI step (show the prompt), and deal with pending connections one at a time with request_connection. Never claim a flow is built unless a build_flow call returned queued in this turn or you were told it was built.
- Never announce something you do not do in the same turn. No "voy a crear" without calling the tool.
- Mail that arrives: the app has a ready-made "Email to sheet" flow in the Flows page that reacts to real incoming mail. When the user wants something to happen when a mail arrives, offer it ONCE in one sentence; if they decline or ask you to build it, build a Schedule trigger that checks for new mail every 15 minutes (fetch recent emails, Loop per message) and never offer it again.
- DRAFT MODE: if the user declines to connect accounts for now (mockup, draft, "maqueta", "sin conectar"), never call request_connection; build with clearly marked example values and mention which steps will need a connection later.
- Custom APIs: for an HTTP Request to the user's own endpoint, also ask for a sample JSON response.
- Saved templates: when a request clearly matches one, offer it in one sentence with use_template (import=false); when they accept, call use_template with import=true.
- Loops are supported (up to 50 items, failures are marked and the run continues). Always keep every app and step the user requested.
- Never ask for passwords, API keys or codes in chat. Never invent apps, actions, permissions or results. If something is not in the catalog, say so and offer the closest alternative. Never mention tools, markers or mechanics.`;

export async function unifiedResponse(i: UnifiedInput): Promise<Response> {
  const out: Out = { build: null, connect: null, form: null, template: null, templateImport: null, undo: null };
  const trace = new ModelTrace(i.selection.choice, i.selection.strict);
  const catalog = await (i.deps?.catalogText ?? catalogText)(i.userId).catch(() => "Catalog unavailable right now.");
  let reviewText = "";
  if (i.event === "build_done" && i.review) {
    const apps = [...new Set(i.review.steps.map(s => s.app).filter((a): a is string => !!a).map(canonicalApp))];
    const st: Record<string, ConnStatus> = apps.length ? await (i.deps?.connectionStatuses ?? connectionStatuses)(i.userId, apps).catch(() => ({})) : {};
    reviewText = `THE BUILD JUST FINISHED (verified by the app, not by you). Steps on the canvas: ${i.review.steps.map(s => s.label + (s.app ? ` [${s.app}: ${st[canonicalApp(s.app)] ?? "unknown"}]` : "")).join(" -> ") || "none"}.` +
      (i.review.steps.some(s => s.aiPrompt) ? `\nAI prompts written for the user to review:\n${i.review.steps.filter(s => s.aiPrompt).map(s => `- ${s.label}: "${s.aiPrompt}"`).join("\n")}` : "") +
      (i.review.placeholders.length ? `\nSteps still holding placeholder values: ${i.review.placeholders.join("; ")}.` : "\nNo placeholder values remain.") +
      `\nApps still not connected: ${apps.filter(a => (st[canonicalApp(a)] ?? "") !== "connected").join(", ") || "none"}.` +
      `\nNow guide the user through what is pending (see the instructions). Do not rebuild anything.`;
  }
  const system = `${PROMPT}\n\n${catalog}\n\nSaved templates: ${i.templates.length ? i.templates.map(t => `${t.id}: "${t.name}" - ${t.description || "sin descripcion"}`).join(" | ") : "none."}\n\n${i.snapshotText}${reviewText ? `\n\n${reviewText}` : ""}${i.draftMode ? "\n\nDRAFT MODE IS ON for this conversation." : ""}`;
  const messages = [...i.past.map(m => ({ role: m.role, content: m.content })), ...(i.event ? [{ role: "user" as const, content: "[The canvas build just finished. Continue as instructed.]" }] : [{ role: "user" as const, content: i.text }])];

  const tools = {
    show_form: tool({
      description: "Ask for several concrete details at once with a small form card (1-4 field labels). Use only when one conversational question is not enough.",
      inputSchema: z.object({ title: z.string().min(2).max(80), fields: z.array(z.string().min(2).max(80)).min(1).max(4), offer_create: z.boolean().optional().describe("add a 'let you create it' button") }),
      execute: async ({ title, fields, offer_create }) => { out.form = { title, fields: fields.map((l, k) => ({ key: `f${k}`, label: l })), offerCreate: !!offer_create }; return { shown: true }; },
    }),
    request_connection: tool({
      description: "Show the connect card for one app the flow needs and is not connected yet. The app checks the real status itself.",
      inputSchema: z.object({ app: z.string().min(2).max(40).describe("lowercase app id from the catalog or the Composio toolkit slug") }),
      execute: async ({ app }) => {
        if (i.draftMode) return { shown: false, reason: "draft mode: do not ask to connect now" };
        const o = await (i.deps?.connectOutcome ?? connectOutcome)(i.userId, app);
        if (o.kind === "card") { out.connect = o.card; return { shown: true, note: "A card with the permissions is shown below your message." }; }
        if (o.kind === "already_connected") return { shown: false, reason: "already connected, continue" };
        if (o.kind === "manual") return { shown: false, reason: `${o.name} connects from the Connections page with: ${o.fields.join(", ")}. No card can be shown here; tell the user that.` };
        if (o.kind === "pending") return { shown: false, reason: "connection is still finishing" };
        if (o.kind === "check_failed") return { shown: false, reason: "could not verify the status; offer to retry, do not ask to connect again" };
        return { shown: false, reason: "unknown app, not available" };
      },
    }),
    build_flow: tool({
      description: "Build or change the canvas. Call only when the user confirmed the plan or directly asked for the change.",
      inputSchema: z.object({ plan: z.string().min(10).max(3500).describe("the COMPLETE agreed flow with every concrete detail") }),
      execute: async ({ plan }) => { out.build = plan; return { queued: true, note: "The canvas build starts right after your message." }; },
    }),
    undo_last_change: tool({ description: "Undo the last canvas change when the user asks to revert.", inputSchema: z.object({}), execute: async () => { out.undo = true; return { queued: true }; } }),
    use_template: tool({
      description: "Offer (import=false) or import (import=true) one of the saved templates listed in the context. Only ids from that list.",
      inputSchema: z.object({ id: z.string().max(64), import: z.boolean() }),
      execute: async ({ id, import: doImport }) => {
        const hit = i.templates.find(t => t.id === id); if (!hit) return { ok: false, reason: "unknown template id" };
        if (doImport) out.templateImport = hit; else out.template = hit; return { ok: true };
      },
    }),
  };

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const textId = "t1";
        let reply = ""; let started = false; let lastError: unknown = null;
        for (const route of i.selection.routes) {
          const t0 = Date.now();
          try {
            const res = streamText({ model: (i.deps?.model ?? languageModel)(route), system, messages, tools, stopWhen: stepCountIs(6), maxOutputTokens: route.maxTokens, temperature: 0.4, maxRetries: 0, abortSignal: AbortSignal.timeout(50_000) });
            let produced = false; let failed: unknown = null; let sepNeeded = false;
            for await (const part of res.fullStream) {
              if (part.type === "error") { failed = part.error; break; }
              if (part.type === "start-step") { sepNeeded = reply.trim().length > 0; continue; }
              if (part.type === "tool-call") produced = true;
              if (part.type === "text-delta" && part.text) {
                produced = true;
                if (!started) { writer.write({ type: "text-start", id: textId }); started = true; }
                const delta = (sepNeeded ? "\n\n" : "") + part.text; sepNeeded = false;
                reply += delta; writer.write({ type: "text-delta", id: textId, delta });
              }
            }
            if (failed && !(produced || reply)) throw failed;
            if (failed) console.error("[workflow-chat] stream broke mid-reply", route.name, route.model);
            if (!reply.trim() && !out.build && !out.connect && !out.form && !out.template && !out.templateImport && !out.undo) throw new Error("empty reply");
            trace.record("chat", route, true, t0);
            break;
          } catch (e) {
            lastError = e; trace.record("chat", route, false, t0, e);
            out.build = out.connect = out.form = out.template = out.templateImport = out.undo = null;
            if (i.selection.strict) break;
          }
        }
        const s = trace.summary();
        if (!s.used) {
          const f = trace.entries[trace.entries.length - 1];
          const msg = i.selection.strict ? `El modelo elegido (${f?.route}/${f?.model}) no respondio${f?.status ? ` (${f.status})` : ""}. No se uso ningun otro modelo. Tu mensaje quedo guardado; probá de nuevo.` : "The free AI model didn't answer (it may be busy). Your message was kept; send it again in a moment.";
          void lastError; writer.write({ type: "data-chat-error", data: { error: msg } }); return;
        }
        if (!started) { writer.write({ type: "text-start", id: textId }); started = true; }
        if (!reply.trim()) { reply = out.build ? "Armando el flujo en el lienzo." : out.connect ? "Para seguir, conectá esta cuenta con la tarjeta de abajo." : out.undo ? "Deshago el último cambio." : out.templateImport ? "Importo la plantilla." : out.form ? out.form.title : "Listo."; writer.write({ type: "text-delta", id: textId, delta: reply }); }
        writer.write({ type: "text-end", id: textId });
        await (i.deps?.append ?? append)(i.userId, i.workflowId, "assistant", reply.trim());
        if (i.selection.choice !== "auto" || s.fellBack || s.paid) writer.write({ type: "data-model-trace", data: s });
        writer.write({ type: "data-chat-result", data: { build: out.build, connect: out.connect, form: out.connect || out.build ? null : out.form, template: out.connect || out.build ? null : out.template, templateImport: out.connect ? null : out.templateImport, undo: out.undo && !out.connect && !out.build ? true : null, autoBuild: !!out.build && !out.connect && !out.template && !out.templateImport, unified: true } });
      },
    }),
  });
}
