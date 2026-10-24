import "server-only";
import { createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, tool } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { toModelMessages } from "@/lib/agent/model-messages";
import { z } from "zod";
import type { LlmRoute } from "@/lib/free-models";
import { type Selection, ModelTrace, languageModel } from "@/lib/model-select";
import { type ConnStatus, canonicalApp, catalogText, connectOutcome, connectionStatuses } from "@/lib/agent/capabilities";
import { type Operation, type Shadow, computeFlowErrors, createBuildTools, lineageFacts, missingMediaKinds, fixFormulaRefsIn, getSystemPrompt } from "@/lib/agent/build-core";
import { findPlaceholders } from "@/lib/agent/review";
import { layoutPositions } from "@/lib/auto-layout";
import type { FlowEdge, FlowNode } from "@/lib/flow-validator";
import { append } from "@/lib/workflow-chat";
import { judgeStanding, type Standing } from "@/lib/agent/objective";
import { discoverComposio } from "@/plugins/composio/steps/catalog";

// ONE agent: the conversation AND the canvas build run in the same loop, with the same messages, the same reasoning and the same
// tools. It calls the builder tools (add_node, connect, ...) itself; the deterministic validators, the corrective rounds and the
// wall-clock cap live around that loop (lib/agent/build-core.ts), and what is pending afterwards comes from the real graph.
async function loadTemplateRow(userId: string, id: string) {
  const [{ db }, { workflowTemplates, members }, { eq, and }] = await Promise.all([import("@/lib/db"), import("@/lib/db/schema"), import("drizzle-orm")]);
  const t = await db.query.workflowTemplates.findFirst({ where: eq(workflowTemplates.id, id) });
  if (!t) return null;
  if (t.orgId) { const m = await db.query.members.findFirst({ where: and(eq(members.organizationId, t.orgId), eq(members.userId, userId)) }); if (!m) return null; } else if (t.userId !== userId) return null;
  return { name: String(t.name), nodes: t.nodes as unknown[], edges: t.edges as unknown[] };
}

export type UnifiedInput = {
  userId: string; workflowId: string; text: string;
  past: { role: "user" | "assistant"; content: string }[]; snapshotText: string; templates: { id: string; name: string; description: string }[];
  canvas: { nodes: unknown[]; edges: unknown[] } | null;
  selection: Extract<Selection, { ok: true }>; draftMode: boolean;
  /** Test seams only: production never passes these. */
  deps?: { loadTemplate?: (userId: string, id: string) => Promise<{ name: string; nodes: unknown[]; edges: unknown[] } | null>; model?: (r: LlmRoute) => LanguageModel; append?: typeof append; catalogText?: typeof catalogText; connectOutcome?: typeof connectOutcome; connectionStatuses?: typeof connectionStatuses; judge?: typeof judgeStanding; discover?: (input: { catalog: string; search?: string; toolkit?: string }) => Promise<{ items?: Record<string, unknown>[] }> };
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
  let planText = ""; let flowName = ""; let touched = false; let heldChars = 0; const composioMap = new Map<string, string[]>();
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
              if (out.connect) return { shown: false, reason: "a connection card is already shown; one at a time: mention this app in text and ask for it after the user finishes the current card" };
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
            description: "Offer (import=false) or import (import=true) one of the saved templates listed in the context. Only ids from that list. Importing puts the template's steps on the canvas (same graph the app validates); you get back its real structure to COMPARE with what the user asked for (trigger, data source, apps, quantities). Import only when it fits what was agreed; if it differs, say exactly what differs and either adapt the steps with your tools or build the agreed flow instead. Never present a template as the requested flow if it differs.",
            inputSchema: z.object({ id: z.string().max(64), import: z.boolean() }),
            execute: async ({ id, import: doImport }) => {
              const hit = i.templates.find(t => t.id === id); if (!hit) return { ok: false, reason: "unknown template id" };
              if (!doImport) { out.template = hit; return { ok: true }; }
              if (shadow.nodes.some(n => (n.data as { config?: { placeholder?: boolean } } | undefined)?.config?.placeholder !== true)) return { ok: false, reason: "the canvas already has steps; a template import would replace them. Edit the existing steps with your tools instead." };
              const tpl = await (i.deps?.loadTemplate ?? loadTemplateRow)(i.userId, id).catch(() => null);
              if (!tpl) return { ok: false, reason: "could not load that template; build the flow with your tools" };
              // Same ids as the template (its {{@id:Label.field}} references stay valid); no connections carried over.
              shadow.nodes.length = 0; shadow.edges.length = 0;
              for (const raw of tpl.nodes as FlowNode[]) { const n = JSON.parse(JSON.stringify(raw)) as FlowNode; const d = (n.data ?? {}) as { config?: Record<string, unknown>; status?: string }; if (d.config) { delete d.config.integrationId; d.config.fromTemplate = true; } d.status = "idle"; n.data = d as FlowNode["data"]; shadow.nodes.push(n); writer.write({ type: "data-canvas-op", data: { op: "addNode", node: n } satisfies Operation }); }
              for (const e of tpl.edges as FlowEdge[]) { shadow.edges.push(e); writer.write({ type: "data-canvas-op", data: { op: "addEdge", edge: e } satisfies Operation }); }
              touched = true; if (!flowName) flowName = tpl.name;
              const cfgOf = (n: FlowNode) => ((n.data as { config?: Record<string, unknown> })?.config ?? {}) as Record<string, unknown>;
              return { ok: true, imported: tpl.name, structure: shadow.nodes.map(n => ({ id: n.id, label: (n.data as { label?: string })?.label, kind: (n.data as { type?: string })?.type, action: cfgOf(n).actionType ?? cfgOf(n).triggerType ?? null, schedule: cfgOf(n).cron ?? cfgOf(n).schedule ?? null })), note: "These steps are now on the canvas. Compare trigger, data source, apps and quantities with the agreed request and fix or report every difference." };
            },
          }),
        };

        // One pass of the agent loop. Text is shown only when `visible` (corrective rounds are internal).
        type PassLog = { stage: string; steps: number; tools: Record<string, number>; finish: string; error?: { status: unknown; note: string }; ms: number; nodesAfter: number; capHit: boolean };
        const passLog: PassLog[] = []; const rounds: { round: number; errors: number; sample: string[] }[] = []; let closeReason = "no-build";
        let stageName = "chat";
        const runPass = async (route: LlmRoute, messages: ModelMessage[], visible: boolean) => {
          const tp = Date.now(); const log: PassLog = { stage: stageName, steps: 0, tools: {}, finish: "unknown", ms: 0, nodesAfter: 0, capHit: false }; passLog.push(log);
          const res = streamText({ model: (i.deps?.model ?? languageModel)(route), system, messages, tools, stopWhen: stepCountIs(30), maxOutputTokens: Math.max(route.maxTokens, 8192), temperature: 0.3, maxRetries: 0, abortSignal: abort.signal });
          let produced = false; let failed: unknown = null; let sep = false;
          for await (const part of res.fullStream) {
            if (part.type === "error") { failed = part.error; break; }
            if (part.type === "start-step") { log.steps++; sep = visible && reply.trim().length > 0; continue; }
            if (part.type === "finish") log.finish = String((part as { finishReason?: unknown }).finishReason ?? "unknown");
            if (part.type === "tool-call") { produced = true; log.tools[part.toolName] = (log.tools[part.toolName] ?? 0) + 1; }
            if (part.type === "text-delta" && part.text) { produced = true; if (visible) { if (touched) heldChars += part.text.length; else { emit((sep ? "\n\n" : "") + part.text); sep = false; } } }
          }
          const fe = failed as { statusCode?: number; status?: number; message?: string } | null;
          log.ms = Date.now() - tp; log.nodesAfter = shadow.nodes.length; log.capHit = abort.signal.aborted;
          if (failed) { log.finish = "error"; log.error = { status: fe?.statusCode ?? fe?.status ?? "error", note: String(fe?.message ?? "").slice(0, 120) }; }
          if (failed && !produced) throw failed;
          if (failed) { console.error("[workflow-chat] pass broke midway", route.name, route.model); interrupted = true; }
          const response = failed ? { messages: [] as ModelMessage[] } : await res.response;
          return toModelMessages(response.messages);
        };

        let usedRoute = false; let validationLeft: string[] = []; let interrupted = false;
        const standing = new Map<string, Standing>(); const skipKinds = new Set<string>(); let unresolvedKinds: string[] = [];
        const userMsgs = [...i.past.filter(m => m.role === "user").map(m => m.content), i.text];
        const resolveObjective = async (route: LlmRoute) => {
          // Experiment, QA selector only: a second reasoning call that can only RELAX the check for a clearly withdrawn deliverable.
          skipKinds.clear(); unresolvedKinds = [];
          if (i.selection.choice === "auto") return;
          const cand = missingMediaKinds(userRequest, shadow.nodes).filter(k => !standing.has(k) || standing.get(k) === "error");
          if (cand.length) { const j = await (i.deps?.judge ?? judgeStanding)((i.deps?.model ?? languageModel)(route), userMsgs, cand, abort.signal); for (const k of cand) standing.set(k, j[k] ?? "error"); }
          for (const [k, v] of standing) { if (v === "withdrawn") skipKinds.add(k); else if (v === "unclear") unresolvedKinds.push(k); }
        };
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
                fixFormulaRefsIn(shadow); await resolveObjective(route);
                errs = computeFlowErrors(shadow, { composioCatalogMap: composioMap, sheetContracts: [], userPrompt: request, userRequest, skipDeliverables: skipKinds });
                rounds.push({ round, errors: errs.length, sample: errs.slice(0, 3).map(e => e.slice(0, 90)) });
                if (!errs.length) { closeReason = "clean"; break; }
                if (abort.signal.aborted) { closeReason = "cap-reached"; break; }
                stageName = `corrective-${round + 1}`;
                const nodeList = shadow.nodes.map(n => `- ${n.id}: ${JSON.stringify({ label: (n.data as { label?: string })?.label, config: (n.data as { config?: unknown })?.config })}`).join("\n");
                const edgeList = shadow.edges.map(e => `- ${e.source} -> ${e.target}`).join("\n");
                msgs = [...msgs, { role: "user", content: `[App check, not from the user] The canvas you built has these DETERMINISTIC VALIDATION ERRORS:\n${errs.map(e => `- ${e}`).join("\n")}\n\nCurrent nodes:\n${nodeList}\nCurrent edges:\n${edgeList}\n\nFix exactly these errors with tool calls (update_parameters / connect / add_node / remove_node). Do NOT rebuild from scratch; reuse existing node ids. Do not write a message to the user in this pass.` }];
                const tr2 = Date.now();
                try { msgs = [...msgs, ...(await runPass(route, msgs, false))]; trace.record("corrective", route, true, tr2); } catch (e) { trace.record("corrective", route, false, tr2, e); closeReason = "corrective-failed"; break; }
              }
              if (closeReason === "no-build") closeReason = "rounds-exhausted";
              await resolveObjective(route);
              fixFormulaRefsIn(shadow); validationLeft = computeFlowErrors(shadow, { composioCatalogMap: composioMap, sheetContracts: [], userPrompt: request, userRequest, skipDeliverables: skipKinds });
              timedOut = abort.signal.aborted;
              if (closeReason === "rounds-exhausted" && !validationLeft.length) closeReason = "clean-after-last-round";
              if (startedEmpty && shadow.nodes.length) { const pos = layoutPositions(shadow.nodes, shadow.edges); for (const n of shadow.nodes) { const p = pos.get(n.id); if (p) { (n as { position?: unknown }).position = p; } } }
              for (const n of shadow.nodes) { const c = (n.data as { config?: Record<string, unknown> } | undefined)?.config; if (c?.placeholder === true && (typeof c.actionType === "string" || typeof c.triggerType === "string" || typeof c.scheduleCron === "string" || typeof c.cron === "string")) delete c.placeholder; }
              if (interrupted || timedOut || validationLeft.length) emit(`${reply.trim() ? "\n\n" : ""}Estado del armado: PARCIAL${interrupted ? " (se cortó una llamada al modelo)" : timedOut ? " (llegó al tiempo límite)" : ""}${validationLeft.length ? `, ${validationLeft.length} punto${validationLeft.length === 1 ? "" : "s"} sin resolver` : ""}. Lo que sigue describe lo que quedó en el lienzo; puede no cumplir todo lo pedido.`);
              writer.write({ type: "data-canvas-final", data: { name: flowName, nodes: shadow.nodes, edges: shadow.edges, validation: validationLeft, timedOut, startedEmpty, interrupted } });
              // Same agent, same conversation: it now sees what the app verified and guides the user through what is pending.
              const fresh = shadow.nodes.filter(n => !initialIds.has(n.id));
              const apps = [...new Set(fresh.map(n => { const c = ((n.data as { config?: { actionType?: string; toolkit?: string } })?.config) ?? {}; return c.toolkit || (c.actionType && c.actionType.includes("/") ? c.actionType.split("/")[0] : ""); }).filter(a => a && a !== "composio").map(canonicalApp))];
              const st: Record<string, ConnStatus> = apps.length ? await (i.deps?.connectionStatuses ?? connectionStatuses)(i.userId, apps).catch(() => ({})) : {};
              const aiPrompts = fresh.map(n => ({ label: String((n.data as { label?: string })?.label ?? "step"), p: String(((n.data as { config?: { aiPrompt?: string } })?.config?.aiPrompt) ?? "") })).filter(x => x.p);
              const trig = shadow.nodes.filter(n => (n.data as { type?: string })?.type === "trigger").map(n => { const c = ((n.data as { config?: Record<string, unknown> })?.config) ?? {}; return `${String(c.actionType ?? "?")}${c.cron ? ` (${String(c.cron)})` : ""}`; }).join(", ") || "none";
              const review = `[App report after your build, verified by the app, not from the user] Trigger on the canvas: ${trig}. Steps now on the canvas: ${shadow.nodes.map(n => String((n.data as { label?: string })?.label ?? n.id)).join(" -> ") || "none"}.` +
                (aiPrompts.length ? `\nAI prompts you wrote (ask the user to review them, show them):\n${aiPrompts.map(x => `- ${x.label}: "${x.p.slice(0, 600)}"`).join("\n")}` : "") +
                `\nData flow facts (app-computed): ${lineageFacts(shadow).join(" ")} Compare them with what the user asked for (quantities, per-item work, data that must feed a step) and say plainly any gap; never call it complete if they disagree.\nApps still NOT connected (mention ALL of them; offer one card at a time): ${apps.filter(a => st[a] !== "connected").map(a => `${a}: ${st[a] ?? "unknown"}`).join(", ") || "none"}.\nSteps still holding placeholder values: ${findPlaceholders(fresh).join("; ") || "none"}.\nApps used and their connection status: ${apps.map(a => `${a}: ${st[a] ?? "unknown"}`).join(", ") || "none"}.` +
                (validationLeft.length ? `\nUnresolved checks: ${validationLeft.join(" | ").slice(0, 900)}. Say plainly what is still missing; never claim it is complete.` : "") +
                (timedOut ? "\nThe build hit the time limit; say what is pending." : "") + (unresolvedKinds.length ? `\nUnresolved from the user's own words (not in the flow): ${unresolvedKinds.join(", ")}. Still required by the check; if the user did not clearly keep or drop it, ask ONE short question.` : "") + (interrupted ? "\nA model call was interrupted by an error while building; the canvas may be incomplete. Say so plainly." : "") +
                `\nNow tell the user in your own words: what you built (one sentence), then guide what is pending, one thing at a time (AI prompt review, request_connection for apps not connected${i.draftMode ? "; DRAFT MODE: do not request connections" : ""}). Do not rebuild anything.`;
              stageName = "guide";
              const guideAbort = new AbortController(); const gt = setTimeout(() => guideAbort.abort(), 45_000);
              try {
                const gres = streamText({ model: (i.deps?.model ?? languageModel)(route), system, messages: [...msgs, { role: "user", content: review }], tools: { request_connection: tools.request_connection, show_form: tools.show_form }, stopWhen: stepCountIs(4), maxOutputTokens: 4096, temperature: 0.3, maxRetries: 0, abortSignal: guideAbort.signal });
                let sep = reply.trim().length > 0;
                const gl: PassLog = { stage: "guide", steps: 0, tools: {}, finish: "unknown", ms: 0, nodesAfter: shadow.nodes.length, capHit: false }; const tg = Date.now(); let chars = 0; passLog.push(gl);
                for await (const part of gres.fullStream) { if (part.type === "start-step") gl.steps++; if (part.type === "finish") gl.finish = String((part as { finishReason?: unknown }).finishReason ?? "unknown"); if (part.type === "error") { const ge = part.error as { statusCode?: number; message?: string }; gl.finish = "error"; gl.error = { status: ge?.statusCode ?? "error", note: String(ge?.message ?? "").slice(0, 120) }; } if (part.type === "tool-call") gl.tools[part.toolName] = (gl.tools[part.toolName] ?? 0) + 1; if (part.type === "text-delta" && part.text) { chars += part.text.length; emit((sep ? "\n\n" : "") + part.text); sep = false; } }
                gl.ms = Date.now() - tg; (gl as PassLog & { textChars?: number }).textChars = chars;
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
        if (!reply.trim()) emit(touched ? (interrupted || validationLeft.length || timedOut ? "Dejé una parte del flujo en el lienzo pero quedó incompleta: no pude terminar de armarlo ni de revisarlo. Podés deshacerlo desde el chat o decime cómo seguimos." : "Dejé el flujo en el lienzo. Pasó las revisiones estructurales, pero todavía no confirmé que haga todo lo pedido: revisalo conmigo.") : out.connect ? "Para seguir, conectá esta cuenta con la tarjeta de abajo." : out.undo ? "Deshago el último cambio." : out.templateImport ? "Importo la plantilla." : out.form ? out.form.title : "Listo.");
        if (started) writer.write({ type: "text-end", id: textId });
        await (i.deps?.append ?? append)(i.userId, i.workflowId, "assistant", reply.trim());
        if (i.selection.choice !== "auto" || s.fellBack || s.paid) {
          // Redacted, QA-only: structure and counts, never message text or keys.
          const build = { heldPreValidationChars: heldChars, version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7), objective: Object.fromEntries(standing), closeReason: interrupted ? `${closeReason}+model-call-interrupted` : closeReason, capMs, elapsedMs: Date.now() - t0, interrupted, finalNodes: shadow.nodes.length, finalEdges: shadow.edges.length, validationLeft: validationLeft.slice(0, 5).map(e => e.slice(0, 120)), rounds, passes: passLog };
          console.info("[ai-build-trace]", JSON.stringify(build));
          writer.write({ type: "data-model-trace", data: { ...s, build } });
        }
        writer.write({ type: "data-chat-result", data: { build: null, built: touched, connect: out.connect, form: out.connect || touched ? null : out.form, template: out.connect || touched ? null : out.template, templateImport: out.connect ? null : out.templateImport, undo: out.undo && !out.connect && !touched ? true : null, autoBuild: false, unified: true } });
      },
    }),
  });
}
