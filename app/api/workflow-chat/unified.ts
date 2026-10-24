import "server-only";
import { createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, tool } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod";
import type { LlmRoute } from "@/lib/free-models";
import { type Selection, ModelTrace, languageModel } from "@/lib/model-select";
import { type ConnStatus, canonicalApp, catalogText, connectOutcome, connectionStatuses } from "@/lib/agent/capabilities";
import { type Operation, type Shadow, computeFlowErrors, createBuildTools, fixFormulaRefsIn, getSystemPrompt } from "@/lib/agent/build-core";
import { findPlaceholders } from "@/lib/agent/review";
import { layoutPositions } from "@/lib/auto-layout";
import type { FlowEdge, FlowNode } from "@/lib/flow-validator";
import { append } from "@/lib/workflow-chat";
import { discoverComposio } from "@/plugins/composio/steps/catalog";

// ONE agent: the conversation AND the canvas build run in the same loop, with the same messages, the same reasoning and the same
// tools. It calls the builder tools (add_node, connect, ...) itself; the deterministic validators, the corrective rounds and the
// wall-clock cap live around that loop (lib/agent/build-core.ts), and what is pending afterwards comes from the real graph.
export type UnifiedInput = {
  userId: string; workflowId: string; text: string;
  past: { role: "user" | "assistant"; content: string }[]; snapshotText: string; templates: { id: string; name: string; description: string }[];
  canvas: { nodes: unknown[]; edges: unknown[] } | null;
  selection: Extract<Selection, { ok: true }>; draftMode: boolean;
  /** Test seams only: production never passes these. */
  deps?: { model?: (r: LlmRoute) => LanguageModel; append?: typeof append; catalogText?: typeof catalogText; connectOutcome?: typeof connectOutcome; connectionStatuses?: typeof connectionStatuses; discover?: (input: { catalog: string; search?: string; toolkit?: string }) => Promise<{ items?: Record<string, unknown>[] }> };
};
type Out = { connect: Record<string, unknown> | null; form: { title: string; fields: { key: string; label: string }[]; offerCreate: boolean } | null; template: { id: string; name: string; description: string } | null; templateImport: { id: string; name: string; description: string } | null; undo: boolean | null };

const PROMPT = `You are Active-clone's workflow agent: ONE conversation that understands the request, knows which integrations exist, asks only for what is genuinely missing, agrees the whole flow with the user, builds it on the canvas, and then walks them through what still needs their attention. You talk like a capable colleague: natural, warm, direct. The user is a non-technical owner who does not want to do the work - you do it, they stay in charge. Always answer in the exact language the user writes in. Plain, short sentences. No jargon.
HOW YOU WORK:
- Conversation first, ceremony never. Never sound like a setup wizard, a phone menu or a questionnaire. Do not repeat the user's request back as a plan; add value: what you would use, what is still open.
- Use the catalog below to decide what the flow needs. Decide yourself what the user delegated or does not care about (names, intervals, columns, reasonable defaults) and say what you picked in passing. When the user leaves a detail to you ("crea vos", "elegi vos", "como quieras", "your choice", a form's "Crealo por mi"), it is settled: never ask it again.
- Ask only about decisions that change the flow and that you cannot decide: which provider or app to use when several fit, which spreadsheet/page/channel/address, which filter. Judge it case by case; there is no fixed list of questions. One thing at a time, woven into the conversation. When several concrete details are needed together, use show_form. Never ask for values that an earlier step produces (order ids, totals, statuses, search results, buyer names): they are wired automatically.
- Never ask again for something already given or delegated, and never re-offer something the user declined.
- Read the whole request before asking anything. Do not ask what the user already answered or left open on purpose ("and/or" means either is fine); ask only what really changes the flow.
- The plan must deliver the exact end result the user asked for, every deliverable and quantity of it. If the catalog cannot produce part of it, say so plainly and offer the closest option; never silently drop a deliverable and never replace it with an intermediate artifact.
- Settle the flow BEFORE building: when the picture is complete, say the plan in a few plain sentences (what triggers it, the steps in order, what the result is) and ask something natural like "Lo armo asi?". If the user directly asks for the build or already confirmed, build right away.
- To build: FIRST call start_build once with "plan" = the COMPLETE agreed flow with every concrete detail from the conversation (apps, order of steps, filters, spreadsheet names, wording, the final result the user asked for). The app checks your canvas against that plan. THEN build it yourself, in this same turn, with set_name, add_node, connect, update_parameters and remove_node, following the BUILDER RULES below. You are the same agent that talked to the user: use everything agreed in the conversation, do not reinterpret it.
- Edits after the build: the plan already agreed stays valid. Change only what the user asked: call start_build with the full updated plan, then edit only the affected nodes with the build tools, keeping every earlier decision unless the user changed it.
- After a build you are told what really got built and what is pending. Then, in your own words: say what you built in one sentence, ask the user to review the AI prompt you wrote when the flow has an AI step (show the prompt), and deal with pending connections one at a time with request_connection. Never claim a flow is built unless the build tools succeeded in this turn; you will be told what the app verified after you finish building.
- Connections come AFTER the flow is agreed and built, not as the opening move: do not ask the user to connect an app while you are still defining the flow (unless a real value from their account is needed to decide something). Mention in passing which accounts the flow will need.
- Never announce something you do not do in the same turn. No "voy a crear" without calling the tool.
- Mail that arrives: the app has a ready-made "Email to sheet" flow in the Flows page that reacts to real incoming mail. When the user wants something to happen when a mail arrives, offer it ONCE in one sentence; if they decline or ask you to build it, build a Schedule trigger that checks for new mail every 15 minutes (fetch recent emails, Loop per message) and never offer it again.
- DRAFT MODE: if the user declines to connect accounts for now (mockup, draft, "maqueta", "sin conectar"), never call request_connection; build with clearly marked example values and mention which steps will need a connection later.
- Custom APIs: for an HTTP Request to the user's own endpoint, also ask for a sample JSON response.
- Saved templates: when a request clearly matches one, offer it in one sentence with use_template (import=false); when they accept, call use_template with import=true.
- Loops are supported (up to 50 items, failures are marked and the run continues). Always keep every app and step the user requested.
- Never ask for passwords, API keys or codes in chat. Never invent apps, actions, permissions or results. If something is not in the catalog, say so and offer the closest alternative. Never mention tools, markers or mechanics.`;

export async function unifiedResponse(i: UnifiedInput): Promise<Response> {
  const out: Out = { connect: null, form: null, template: null, templateImport: null, undo: null };
  const trace = new ModelTrace(i.selection.choice, i.selection.strict);
  const catalog = await (i.deps?.catalogText ?? catalogText)(i.userId).catch(() => "Catalog unavailable right now.");
  const shadow: Shadow = { nodes: [...((i.canvas?.nodes ?? []) as FlowNode[])], edges: [...((i.canvas?.edges ?? []) as FlowEdge[])] };
  const startedEmpty = shadow.nodes.every(n => (n.data as { config?: { placeholder?: boolean } } | undefined)?.config?.placeholder === true);
  const initialIds = new Set(shadow.nodes.map(n => n.id));
  let planText = ""; let flowName = ""; let touched = false; const composioMap = new Map<string, string[]>();
  const userRequest = [...i.past.filter(m => m.role === "user").map(m => m.content), i.text].join("\n");
  const discover = (i.deps?.discover ?? ((x: { catalog: string; search?: string; toolkit?: string }) => discoverComposio(x as Parameters<typeof discoverComposio>[0]))) as (x: { catalog: string; search?: string; toolkit?: string }) => Promise<{ items?: Record<string, unknown>[] }>;
  const canvasDesc = shadow.nodes.length ? `EXISTING CANVAS (edit these, keep their ids; do not recreate):\n${shadow.nodes.map(n => `- ${n.id}: ${JSON.stringify({ label: (n.data as { label?: string })?.label, config: (n.data as { config?: unknown })?.config }).slice(0, 600)}`).join("\n")}\nEdges: ${shadow.edges.map(e => `${e.source}->${e.target}`).join(", ") || "none"}` : "The canvas is empty.";
  const system = `${PROMPT}\n\nBUILDER RULES (how nodes, ids, templates and configs must look when you build):\n${getSystemPrompt("", "tools")}\n\nExternal apps (Composio) are discovered live: when the flow needs an app that is not native, use find_external_apps to see what exists and lookup_app_actions to get its exact action slugs and required parameters BEFORE planning with it. Use only slugs those tools returned; if they are unavailable, say what is missing.\n\n${catalog}\n\nSaved templates: ${i.templates.length ? i.templates.map(t => `${t.id}: "${t.name}" - ${t.description || "sin descripcion"}`).join(" | ") : "none."}\n\n${canvasDesc}${i.draftMode ? "\n\nDRAFT MODE IS ON for this conversation." : ""}`;
  const baseMessages: ModelMessage[] = [...i.past.map(m => ({ role: m.role, content: m.content }) as ModelMessage), { role: "user", content: i.text }];

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const capMs = Number(process.env.AI_BUILD_CAP_MS) > 0 ? Number(process.env.AI_BUILD_CAP_MS) : 210 * 1000;
        const t0 = Date.now(); const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), capMs);
        const textId = "t1"; let reply = ""; let started = false; let timedOut = false;
        const emit = (delta: string) => { if (!delta) return; if (!started) { writer.write({ type: "text-start", id: textId }); started = true; } reply += delta; writer.write({ type: "text-delta", id: textId, delta }); };
        const buildTools = createBuildTools(shadow, { noAsk: true, onName: n => { flowName = n; touched = true; }, onOp: (op: Operation) => { touched = true; writer.write({ type: "data-canvas-op", data: op }); } });
        const tools = {
          ...buildTools,
          start_build: tool({
            description: "Declare the COMPLETE agreed flow before building or editing the canvas. Call once, first, then build with the other tools in the same turn.",
            inputSchema: z.object({ plan: z.string().min(10).max(4000) }),
            execute: async ({ plan }) => { planText = plan; return { ok: true, note: "Now build it: set_name, add_node for each step, connect, update_parameters." }; },
          }),
          find_external_apps: tool({
            description: "Search the live catalog of external apps (Composio toolkits) by keyword, e.g. 'notion', 'calendar', 'crm'. Returns toolkit slugs and descriptions.",
            inputSchema: z.object({ search: z.string().min(2).max(60) }),
            execute: async ({ search }) => { try { const r = await discover({ catalog: "toolkits", search }); return { apps: (r.items ?? []).slice(0, 12).map(t => ({ slug: String((t as { slug?: unknown }).slug ?? ""), name: String((t as { name?: unknown }).name ?? ""), description: String(((t as { meta?: { description?: unknown } }).meta?.description) ?? "").slice(0, 120) })) }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "catalog unavailable" }; } },
          }),
          lookup_app_actions: tool({
            description: "List the real actions of one external (Composio) app: exact slugs, what each does, required parameters. Call before planning or building with that app. Native apps are already in the catalog above.",
            inputSchema: z.object({ toolkit: z.string().min(2).max(60).describe("lowercase toolkit slug") }),
            execute: async ({ toolkit }) => {
              try {
                const r = await discover({ catalog: "tools", toolkit }); const slug = toolkit.toLowerCase();
                const actions = (r.items ?? []).map(t => { const ip = ((t as { input_parameters?: { properties?: Record<string, { type?: string }>; required?: string[] } }).input_parameters) ?? {}; return { toolkit: slug, slug: String((t as { slug?: unknown }).slug), name: (t as { name?: unknown }).name, description: String((t as { description?: unknown }).description ?? "").slice(0, 120), required: ip.required ?? [], params: Object.keys(ip.properties ?? {}).slice(0, 12).map(k => `${k}:${String(ip.properties?.[k]?.type ?? "any")}`) }; });
                for (const a of actions) composioMap.set(`${a.toolkit}/${a.slug}`, a.required);
                let list = actions; while (JSON.stringify(list).length > 14000 && list.length > 1) list = list.slice(0, Math.floor(list.length * 0.8));
                return { toolkit: slug, count: actions.length, shown: list.length, actions: list };
              } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "catalog unavailable" }; }
            },
          }),
          show_form: tool({
            description: "Ask for several concrete details at once with a small form card (1-4 field labels). Use only when one conversational question is not enough.",
            inputSchema: z.object({ title: z.string().min(2).max(80), fields: z.array(z.string().min(2).max(80)).min(1).max(4), offer_create: z.boolean().optional() }),
            execute: async ({ title, fields, offer_create }) => { out.form = { title, fields: fields.map((l, k) => ({ key: `f${k}`, label: l })), offerCreate: !!offer_create }; return { shown: true }; },
          }),
          request_connection: tool({
            description: "Show the connect card for one app the flow needs and is not connected yet (one-click sign-in for OAuth apps; apps with their own keys get a card that opens the Connections page). The app checks the real status itself. Never ask for keys in chat.",
            inputSchema: z.object({ app: z.string().min(2).max(40) }),
            execute: async ({ app }) => {
              if (i.draftMode) return { shown: false, reason: "draft mode: do not ask to connect now" };
              const o = await (i.deps?.connectOutcome ?? connectOutcome)(i.userId, app);
              if (o.kind === "card") { out.connect = o.card; return { shown: true, note: "A card is shown below your message." }; }
              if (o.kind === "already_connected") return { shown: false, reason: "already connected, continue" };
              if (o.kind === "manual") return { shown: false, reason: `${o.name} connects from the Connections page with: ${o.fields.join(", ")}.` };
              if (o.kind === "pending") return { shown: false, reason: "connection is still finishing" };
              if (o.kind === "check_failed") return { shown: false, reason: "could not verify the status; offer to retry" };
              return { shown: false, reason: "unknown app, not available" };
            },
          }),
          undo_last_change: tool({ description: "Undo the last canvas change when the user asks to revert.", inputSchema: z.object({}), execute: async () => { out.undo = true; return { queued: true }; } }),
          use_template: tool({
            description: "Offer (import=false) or import (import=true) one of the saved templates listed in the context. Only ids from that list.",
            inputSchema: z.object({ id: z.string().max(64), import: z.boolean() }),
            execute: async ({ id, import: doImport }) => { const hit = i.templates.find(t => t.id === id); if (!hit) return { ok: false, reason: "unknown template id" }; if (doImport) out.templateImport = hit; else out.template = hit; return { ok: true }; },
          }),
        };

        // One pass of the agent loop. Text is shown only when `visible` (corrective rounds are internal).
        const runPass = async (route: LlmRoute, messages: ModelMessage[], visible: boolean) => {
          const res = streamText({ model: (i.deps?.model ?? languageModel)(route), system, messages, tools, stopWhen: stepCountIs(30), maxOutputTokens: Math.max(route.maxTokens, 8192), temperature: 0.3, maxRetries: 0, abortSignal: abort.signal });
          let produced = false; let failed: unknown = null; let sep = false;
          for await (const part of res.fullStream) {
            if (part.type === "error") { failed = part.error; break; }
            if (part.type === "start-step") { sep = visible && reply.trim().length > 0; continue; }
            if (part.type === "tool-call") produced = true;
            if (part.type === "text-delta" && part.text) { produced = true; if (visible) { emit((sep ? "\n\n" : "") + part.text); sep = false; } }
          }
          if (failed && !produced) throw failed;
          if (failed) console.error("[workflow-chat] pass broke midway", route.name, route.model);
          const response = failed ? { messages: [] as ModelMessage[] } : await res.response;
          return response.messages as ModelMessage[];
        };

        let usedRoute = false; let validationLeft: string[] = [];
        for (const route of i.selection.routes) {
          const tr = Date.now();
          try {
            let msgs = baseMessages;
            const produced = await runPass(route, msgs, true);
            msgs = [...msgs, ...produced];
            trace.record("chat", route, true, tr); usedRoute = true;
            // Deterministic checks around the same agent: validators + up to 3 corrective rounds inside the cap.
            if (touched) {
              const request = planText || i.text; let errs: string[] = [];
              for (let round = 0; round < 3; round++) {
                fixFormulaRefsIn(shadow);
                errs = computeFlowErrors(shadow, { composioCatalogMap: composioMap, sheetContracts: [], userPrompt: request, userRequest });
                if (!errs.length || abort.signal.aborted) break;
                const nodeList = shadow.nodes.map(n => `- ${n.id}: ${JSON.stringify({ label: (n.data as { label?: string })?.label, config: (n.data as { config?: unknown })?.config })}`).join("\n");
                const edgeList = shadow.edges.map(e => `- ${e.source} -> ${e.target}`).join("\n");
                msgs = [...msgs, { role: "user", content: `[App check, not from the user] The canvas you built has these DETERMINISTIC VALIDATION ERRORS:\n${errs.map(e => `- ${e}`).join("\n")}\n\nCurrent nodes:\n${nodeList}\nCurrent edges:\n${edgeList}\n\nFix exactly these errors with tool calls (update_parameters / connect / add_node / remove_node). Do NOT rebuild from scratch; reuse existing node ids. Do not write a message to the user in this pass.` }];
                const tr2 = Date.now();
                try { msgs = [...msgs, ...(await runPass(route, msgs, false))]; trace.record("corrective", route, true, tr2); } catch (e) { trace.record("corrective", route, false, tr2, e); break; }
              }
              fixFormulaRefsIn(shadow); validationLeft = computeFlowErrors(shadow, { composioCatalogMap: composioMap, sheetContracts: [], userPrompt: request, userRequest });
              timedOut = abort.signal.aborted;
              if (startedEmpty && shadow.nodes.length) { const pos = layoutPositions(shadow.nodes, shadow.edges); for (const n of shadow.nodes) { const p = pos.get(n.id); if (p) { (n as { position?: unknown }).position = p; } } }
              writer.write({ type: "data-canvas-final", data: { name: flowName, nodes: shadow.nodes, edges: shadow.edges, validation: validationLeft, timedOut, startedEmpty } });
              // Same agent, same conversation: it now sees what the app verified and guides the user through what is pending.
              const fresh = shadow.nodes.filter(n => !initialIds.has(n.id));
              const apps = [...new Set(fresh.map(n => { const c = ((n.data as { config?: { actionType?: string; toolkit?: string } })?.config) ?? {}; return c.toolkit || (c.actionType && c.actionType.includes("/") ? c.actionType.split("/")[0] : ""); }).filter(a => a && a !== "composio").map(canonicalApp))];
              const st: Record<string, ConnStatus> = apps.length ? await (i.deps?.connectionStatuses ?? connectionStatuses)(i.userId, apps).catch(() => ({})) : {};
              const aiPrompts = fresh.map(n => ({ label: String((n.data as { label?: string })?.label ?? "step"), p: String(((n.data as { config?: { aiPrompt?: string } })?.config?.aiPrompt) ?? "") })).filter(x => x.p);
              const review = `[App report after your build, verified by the app, not from the user] Steps now on the canvas: ${shadow.nodes.map(n => String((n.data as { label?: string })?.label ?? n.id)).join(" -> ") || "none"}.` +
                (aiPrompts.length ? `\nAI prompts you wrote (ask the user to review them, show them):\n${aiPrompts.map(x => `- ${x.label}: "${x.p.slice(0, 600)}"`).join("\n")}` : "") +
                `\nSteps still holding placeholder values: ${findPlaceholders(fresh).join("; ") || "none"}.\nApps used and their connection status: ${apps.map(a => `${a}: ${st[a] ?? "unknown"}`).join(", ") || "none"}.` +
                (validationLeft.length ? `\nUnresolved checks: ${validationLeft.join(" | ").slice(0, 900)}. Say plainly what is still missing; never claim it is complete.` : "") +
                (timedOut ? "\nThe build hit the time limit; say what is pending." : "") +
                `\nNow tell the user in your own words: what you built (one sentence), then guide what is pending, one thing at a time (AI prompt review, request_connection for apps not connected${i.draftMode ? "; DRAFT MODE: do not request connections" : ""}). Do not rebuild anything.`;
              const guideAbort = new AbortController(); const gt = setTimeout(() => guideAbort.abort(), 45_000);
              try {
                const gres = streamText({ model: (i.deps?.model ?? languageModel)(route), system, messages: [...msgs, { role: "user", content: review }], tools: { request_connection: tools.request_connection, show_form: tools.show_form }, stopWhen: stepCountIs(4), maxOutputTokens: 4096, temperature: 0.3, maxRetries: 0, abortSignal: guideAbort.signal });
                let sep = reply.trim().length > 0;
                for await (const part of gres.fullStream) { if (part.type === "text-delta" && part.text) { emit((sep ? "\n\n" : "") + part.text); sep = false; } }
              } catch (e) { trace.record("guide", route, false, Date.now(), e); } finally { clearTimeout(gt); }
            }
            break;
          } catch (e) {
            trace.record("chat", route, false, tr, e); usedRoute = false;
            if (i.selection.strict) break;
          }
        }
        clearTimeout(timer);
        const s = trace.summary();
        if (!usedRoute && !s.used) {
          const f = trace.entries[trace.entries.length - 1];
          const msg = i.selection.strict ? `El modelo elegido (${f?.route}/${f?.model}) no respondió${f?.status ? ` (${f.status})` : ""}. No se usó ningún otro modelo. Tu mensaje quedó guardado; probá de nuevo.` : "The free AI model didn't answer (it may be busy). Your message was kept; send it again in a moment.";
          writer.write({ type: "data-chat-error", data: { error: msg } }); return;
        }
        if (!reply.trim()) emit(touched ? "Armé el flujo en el lienzo." : out.connect ? "Para seguir, conectá esta cuenta con la tarjeta de abajo." : out.undo ? "Deshago el último cambio." : out.templateImport ? "Importo la plantilla." : out.form ? out.form.title : "Listo.");
        if (started) writer.write({ type: "text-end", id: textId });
        await (i.deps?.append ?? append)(i.userId, i.workflowId, "assistant", reply.trim());
        if (i.selection.choice !== "auto" || s.fellBack || s.paid) writer.write({ type: "data-model-trace", data: s });
        writer.write({ type: "data-chat-result", data: { build: null, built: touched, connect: out.connect, form: out.connect || touched ? null : out.form, template: out.connect || touched ? null : out.template, templateImport: out.connect ? null : out.templateImport, undo: out.undo && !out.connect && !touched ? true : null, autoBuild: false, unified: true } });
      },
    }),
  });
}
