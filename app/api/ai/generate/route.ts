import { llmRoutes } from "@/lib/free-models";
import OpenAI from "openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { ModelTrace, languageModel, selectRoutes } from "@/lib/model-select";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateAIActionPrompts } from "@/plugins";
import { generateAITriggerPrompts, getActionOutputFields, getActionOutputItemFields, getAllActions, getAllTriggers } from "@/plugins/registry";
import { userIntentText, type FlowEdge, type FlowNode, type SheetColumnsContract, channelConsistencyError, conditionExpressionError, cyclicFlowError, formulaExpressionError, httpSchemaError, listCrossingError, perItemLoopError, planCoverageError, questionActionError, requestCoverageError, sheetContractError, shipmentDetailError, unwiredReportStepError, validateFlow } from "@/lib/flow-validator";
import { type SourceContract, contractPromptBlock, extractApiSample, inspectSheetsContracts } from "@/lib/source-inspector";
import { type Operation, type Shadow, getSystemPrompt, getValidActionTypes, getValidTriggerTypes, shadowApply } from "@/lib/agent/build-core";
import { layoutPositions } from "@/lib/auto-layout";
import { discoverComposio } from "@/plugins/composio/steps/catalog";

function encodeMessage(encoder: TextEncoder, message: object): Uint8Array { return encoder.encode(`${JSON.stringify(message)}\n`); }
function shouldSkipLine(line: string): boolean { const trimmed = line.trim(); return !trimmed || trimmed.startsWith("```"); }
function tryParseAndEnqueueOperation(line: string, encoder: TextEncoder, controller: ReadableStreamDefaultController, operationCount: number, shadow: Shadow): number {
  const trimmed = line.trim(); if (shouldSkipLine(line)) return operationCount;
  try { const operation = JSON.parse(trimmed) as Operation; if (!shadowApply(operation, shadow)) { console.warn("[API] op rejected by guard:", operation.op, trimmed.substring(0, 80)); return operationCount; } const newCount = operationCount + 1; console.log(`[API] Operation ${newCount}:`, operation.op); controller.enqueue(encodeMessage(encoder, { type: "operation", operation })); return newCount; }
  catch { console.warn("[API] Skipping invalid JSON line:", trimmed.substring(0, 50)); return operationCount; }
}
// Extract complete top-level JSON objects by brace balance, tolerating models that
// pretty-print one operation across multiple lines. Text between objects is dropped.
function extractJsonObjects(buf: string): { objs: string[]; rest: string } {
  const objs: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false, last = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}" && depth > 0 && --depth === 0) { objs.push(buf.slice(start, i + 1)); last = i + 1; }
  }
  return { objs, rest: buf.slice(depth > 0 ? start : last) };
}
function processBufferLines(buffer: string, encoder: TextEncoder, controller: ReadableStreamDefaultController, operationCount: number, shadow: Shadow): { remainingBuffer: string; newOperationCount: number } {
  const { objs, rest } = extractJsonObjects(buffer); let newOperationCount = operationCount;
  for (const obj of objs) newOperationCount = tryParseAndEnqueueOperation(obj, encoder, controller, newOperationCount, shadow);
  return { remainingBuffer: rest, newOperationCount };
}
async function processOperationStream(textStream: AsyncIterable<string>, encoder: TextEncoder, controller: ReadableStreamDefaultController, shadow: Shadow): Promise<number> {
  let buffer = ""; let operationCount = 0; let chunkCount = 0; let charCount = 0;
  for await (const chunk of textStream) { chunkCount += 1; charCount += chunk.length; buffer += chunk; const result = processBufferLines(buffer, encoder, controller, operationCount, shadow); buffer = result.remainingBuffer; operationCount = result.newOperationCount; }
  operationCount = tryParseAndEnqueueOperation(buffer, encoder, controller, operationCount, shadow);
  console.log("[ai-generate] stream complete", { chunkCount, charCount, operationCount });
  if (operationCount === 0) throw new Error(chunkCount === 0 ? "The free AI model returned nothing (it may be busy). Your prompt was kept. Try again in a moment." : "The AI answered, but not in a form that could change the workflow. Your prompt was kept. Try rephrasing it.");
  return operationCount;
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || session.user.isAnonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json(); const { prompt, existingWorkflow, toolkits, model } = body; const evalMode = body.evalMode === "fullJson" ? "fullJson" : "ops"; const builderMode = body.builder === "tools" ? "tools" : "ops";
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    if (!llmRoutes().length) return NextResponse.json({ error: "AI API key not configured on server." }, { status: 500 });
    // Optional model pin (used by the eval harness): restrict to the route whose model matches.
    // Model choice: `ai` (g | ds) pins the whole journey, QA users only, never silently falls back. The old raw `model` pin is QA-only too.
    const selection = selectRoutes(body.ai, session.user.id);
    if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: selection.status });
    const qaUser = (process.env.QA_AI_USER_IDS ?? "").split(",").map((x: string) => x.trim()).filter(Boolean).some((x: string) => x === "*" || x === session.user.id);
    const pinnedRoutes = qaUser && selection.choice === "auto" && typeof model === "string" && model ? selection.routes.filter(r => r.model === model) : [];
    const activeRoutes = pinnedRoutes.length ? pinnedRoutes : selection.routes;
    const trace = new ModelTrace(selection.choice, selection.strict || pinnedRoutes.length > 0);
    let composioCatalog = "";
    let composioCatalogMap: Map<string, string[]> = new Map();
    // Apps with a native plugin must never load a Composio catalog: keep them out of detection entirely.
    const toolkitPatterns: Record<string, RegExp> = { outlook: /outlook|hotmail|microsoft/i, gmail: /gmail|e-?mail|mail/i, notion: /notion/i, airtable: /airtable/i, googlesheets: /sheets|spreadsheet|planilla/i, googledocs: /google\s+docs?\b|doc(umento)? de google/i, googledrive: /drive/i, hubspot: /hubspot/i, jira: /jira/i, hackernews: /hacker\s*news/i };
    const promptText = String(prompt);
    // The client sends the toolkits it detected from the user's own text; only fall back to
    // prompt regex (which can hit fixed boilerplate) when the field is absent.
    const requestedToolkits = (Array.isArray(toolkits)
      ? toolkits.filter((t: unknown): t is string => typeof t === "string" && t in toolkitPatterns)
      : Object.keys(toolkitPatterns).filter(k => toolkitPatterns[k].test(promptText))
    ).slice(0, 4);
    if (requestedToolkits.length && !/REAL COMPOSIO ACTIONS/.test(promptText)) {
      const results = await Promise.all(requestedToolkits.map(async toolkit => { try { return { toolkit, result: await discoverComposio({ catalog: "tools", toolkit }) }; } catch (error) { console.error("[ai-generate] Composio catalog lookup failed", toolkit, error instanceof Error ? error.message : "unknown"); return null; } }));
      const compact = (tool: Record<string, unknown>, toolkit: string) => {
        const params = (tool.input_parameters ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
        return { toolkit, slug: tool.slug, name: tool.name, description: String(tool.description ?? "").slice(0, 120), required: params.required ?? [], params: Object.keys(params.properties ?? {}).slice(0, 12) };
      };
      let actions = results.flatMap(entry => entry?.result?.items?.map((tool: Record<string, unknown>) => compact(tool, entry.toolkit)) ?? []);
      composioCatalogMap = new Map(actions.map(a => [`${a.toolkit}/${String(a.slug)}`, a.required]));
      let json = JSON.stringify(actions);
      while (json.length > 40000 && actions.length > 1) { actions = actions.slice(0, Math.floor(actions.length * 0.8)); json = JSON.stringify(actions); }
      console.info("[ai-generate] catalog size", { toolkits: requestedToolkits, actions: actions.length, chars: json.length });
      composioCatalog = actions.length ? `LIVE COMPOSIO ACTION CATALOG (exact slugs; use only these):\n${json}` : "No live Composio action catalog was available. Do not invent Composio actions.";
    }
    // Source contracts: read the real schema of existing sources the user
    // referenced (Google Sheets via their own Composio connection, or a sample
    // JSON they pasted for their own API) so the builder wires verified names.
    const sourceContracts: SourceContract[] = [];
    try {
      const [sheets] = await Promise.all([inspectSheetsContracts(String(prompt), session.user.id)]);
      sourceContracts.push(...sheets);
    } catch { /* inspection never blocks generation */ }
    const apiSample = extractApiSample(String(prompt));
    if (apiSample) sourceContracts.push(apiSample);
    const sheetContracts: SheetColumnsContract[] = sourceContracts.filter((c): c is SheetColumnsContract & { kind: "googlesheets" } => c.kind === "googlesheets").map((c) => ({ spreadsheetId: c.spreadsheetId, sheets: c.sheets }));
    let userPrompt = String(prompt) + contractPromptBlock(sourceContracts);
    if (existingWorkflow) {
      const nodesList = (existingWorkflow.nodes || []).map((n: { id: string; data?: { label?: string } }) => `- ${n.id} (${n.data?.label || "Unlabeled"})`).join("\n");
      const edgesList = (existingWorkflow.edges || []).map((e: { id: string; source: string; target: string }) => `- ${e.id}: ${e.source} -> ${e.target}`).join("\n");
      userPrompt = `I have an existing workflow. Make ONLY the changes requested. If the request only supplies missing setup values (a spreadsheet id or name, an email address, a channel, a folder), apply them with updateNode operations ONLY: do NOT add, remove, replace, retype or rewire any node, and NEVER replace a Fórmula node with another action type (Loop, AI text, etc.) - the existing structure was already validated, preserve every node id, action type and expression verbatim.\nCurrent workflow nodes:\n${nodesList}\nCurrent workflow edges:\n${edgesList}\nFull workflow data (do not recreate existing nodes):\n${JSON.stringify(existingWorkflow, null, 2)}\nUser request: ${prompt}${contractPromptBlock(sourceContracts)}\nOutput only operations needed. Add new edges after nodes. Use existing node ids; avoid overlaps; preserve structure.`;
    }
    async function* textChunks() {
      const failures: string[] = [];
      const safeSummary = (error: unknown) => (error instanceof Error ? error.message : "unknown error").replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]").replace(/(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})/g, "[redacted-key]").slice(0, 240);
      for (const route of activeRoutes) {
        let got = false;
        try {
          console.info("[ai-generate] provider attempt", route.name, route.model);
          const provider = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0, timeout: 15000 });
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: userPrompt }], stream: true, max_tokens: Math.max(8192, route.maxTokens), temperature: 0.2 });
          for await (const chunk of result) { if (chunk.choices[0]?.finish_reason === "length") streamState.truncated = true; const value = chunk.choices[0]?.delta?.content; if (value) { got = true; yield value; } }
          if (got) return;
          failures.push(`${route.name}/${route.model}: empty stream`); console.warn("[ai-generate] provider returned no text", route.name, route.model);
        } catch (error) {
          const detail = safeSummary(error); failures.push(`${route.name}/${route.model}: ${detail}`); console.error("[ai-generate] provider stream failed", route.name, route.model, detail);
          if (got) throw error;
        }
      }
      console.error("[ai-generate] all providers exhausted before content", failures);
    }
    const streamState = { truncated: false };
    const shadow: Shadow = { nodes: [...((existingWorkflow?.nodes ?? []) as FlowNode[])], edges: [...((existingWorkflow?.edges ?? []) as FlowEdge[])] };
    // A brand-new workflow carries only the placeholder trigger; that counts as
    // empty. Any real (user-arranged) node disables the auto-layout.
    const startedEmpty = (existingWorkflow?.nodes ?? []).every((n: FlowNode) => ((n.data as { config?: Record<string, unknown> } | undefined)?.config?.placeholder === true));
    const computeErrors = (): string[] => {
      const errs = validateFlow(shadow.nodes, shadow.edges, getActionOutputFields(), getValidActionTypes(), { validTriggerTypes: getValidTriggerTypes(), composioCatalog: composioCatalogMap, actionItemFields: getActionOutputItemFields(), userPrompt });
      const coverage = planCoverageError(userIntentText(userPrompt), shadow.nodes);
      if (coverage) errs.push(coverage);
      const appCoverage = requestCoverageError(userIntentText(userPrompt), shadow.nodes);
      if (appCoverage) errs.push(appCoverage);
      const channel = channelConsistencyError(userIntentText(userPrompt), shadow.nodes);
      if (channel) errs.push(channel);
      const perItem = perItemLoopError(userIntentText(userPrompt), shadow.nodes);
      if (perItem) errs.push(perItem);
      const shipment = shipmentDetailError(shadow.nodes, shadow.edges);
      if (shipment) errs.push(shipment);
      const questions = questionActionError(userPrompt, shadow.nodes);
      if (questions) errs.push(questions);
      const crossing = listCrossingError(userPrompt, shadow.nodes);
      if (crossing) errs.push(crossing);
      const condExpr = conditionExpressionError(shadow.nodes);
      if (condExpr) errs.push(condExpr);
      const formExpr = formulaExpressionError(shadow.nodes, getActionOutputItemFields());
      if (formExpr) errs.push(formExpr);
      const cyclic = cyclicFlowError(shadow.nodes, shadow.edges);
      if (cyclic) errs.push(cyclic);
      const sheetContract = sheetContractError(shadow.nodes, sheetContracts);
      if (sheetContract) errs.push(sheetContract);
      const httpSchema = httpSchemaError(shadow.nodes);
      if (httpSchema) errs.push(httpSchema);
      const unwired = unwiredReportStepError(shadow.nodes, shadow.edges);
      if (unwired) errs.push(unwired);
      return errs;
    };
    async function runCorrectivePass(operationCount: number, encoder: TextEncoder, controller: ReadableStreamDefaultController, hint = ""): Promise<number> {
      const errors = computeErrors();
      if (!errors.length) return operationCount;
      console.warn("[ai-generate] validation errors", errors);
      const nodeList = shadow.nodes.map(n => `- ${n.id}: ${JSON.stringify({ label: n.data?.label, config: n.data?.config })}`).join("\n");
      const edgeList = shadow.edges.map(e => `- ${e.source} -> ${e.target}`).join("\n");
      const fixPrompt = `The workflow you generated has these DETERMINISTIC VALIDATION ERRORS:\n${errors.map(e => `- ${e}`).join("\n")}\n\nCurrent nodes:\n${nodeList}\nCurrent edges:\n${edgeList}\n\nEmit ONLY the corrective operations needed to fix these exact errors (addNode/addEdge/removeNode/removeEdge/updateNode). Add nodes before the edges that use them. Do NOT recreate existing nodes; reuse their exact ids. Original request: ${userPrompt}${hint}`;
      for (const route of activeRoutes) {
        try {
          console.info("[ai-generate] corrective attempt", route.name, route.model);
          const provider = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0, timeout: 20000 });
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: fixPrompt }], max_tokens: Math.max(4096, route.maxTokens), temperature: 0.2 });
          const text = result.choices[0]?.message?.content ?? "";
          if (!text) continue;
          let count = operationCount;
          const { objs } = extractJsonObjects(text);
          const candidates = objs.length ? objs : text.split("\n");
          for (const piece of candidates) count = tryParseAndEnqueueOperation(piece, encoder, controller, count, shadow);
          return count;
        } catch (error) { console.error("[ai-generate] corrective pass failed", route.name, error instanceof Error ? error.message.slice(0, 200) : "unknown"); }
      }
      return operationCount;
    }
    const encoder = new TextEncoder();
    async function runContinuationPass(operationCount: number, encoder: TextEncoder, controller: ReadableStreamDefaultController): Promise<number> {
      console.warn("[ai-generate] output hit the token limit; running continuation pass");
      const nodeList = shadow.nodes.map(n => `- ${n.id} (${n.data?.label ?? ""} / ${String(n.data?.config?.actionType ?? n.data?.type ?? "")})`).join("\n");
      const edgeList = shadow.edges.map(e => `- ${e.source} -> ${e.target}`).join("\n");
      const contPrompt = `Your previous output was CUT OFF by the output token limit BEFORE the workflow was complete.\n\nNodes already added:\n${nodeList}\nEdges already added:\n${edgeList}\n\nEmit ONLY the remaining operations (addNode/addEdge/updateNode) needed to COMPLETE the original request below. Add nodes before the edges that use them. Do NOT recreate existing nodes or edges; reuse their exact ids. Original request: ${userPrompt}`;
      for (const route of llmRoutes()) {
        try {
          console.info("[ai-generate] continuation attempt", route.name, route.model);
          const provider = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0, timeout: 20000 });
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: contPrompt }], max_tokens: Math.max(8192, route.maxTokens) });
          const text = result.choices[0]?.message?.content ?? "";
          if (!text) continue;
          let count = operationCount;
          for (const line of text.split("\n")) count = tryParseAndEnqueueOperation(line, encoder, controller, count, shadow);
          return count;
        } catch (error) { console.error("[ai-generate] continuation pass failed", route.name, error instanceof Error ? error.message.slice(0, 200) : "unknown"); }
      }
      return operationCount;
    }
    // fullJson experimental mode (?evalMode=fullJson): the model emits ONE
    // complete graph JSON {"name","nodes","edges"}; it is validated at once
    // and corrective passes re-emit the complete corrected JSON. The canvas
    // draws at the end via synthesized operations. Default ("ops") unchanged.
    function parseGraphJson(text: string): { name?: string; nodes?: FlowNode[]; edges?: FlowEdge[] } | null {
      const { objs } = extractJsonObjects(text);
      const candidates = objs.length ? objs : [text];
      for (const piece of candidates) {
        try {
          const g = JSON.parse(piece) as { name?: string; nodes?: FlowNode[]; edges?: FlowEdge[] };
          if (g && Array.isArray(g.nodes) && g.nodes.length > 0 && Array.isArray(g.edges)) return g;
        } catch { /* try the next candidate */ }
      }
      return null;
    }
    async function runFullJsonGeneration(encoder: TextEncoder, controller: ReadableStreamDefaultController): Promise<number> {
      const formatInstr = `\n\nOUTPUT FORMAT FOR THIS REQUEST (overrides the operations format): respond with ONLY ONE JSON object {"name": string, "nodes": [...], "edges": [...]} - the COMPLETE workflow graph in a single document. Nodes and edges use the exact same shapes as the addNode/addEdge operations (each node needs id, type, position {x,y} and data {label, type, config}). No markdown fences, no commentary, no incremental operations.`;
      let graph: { name?: string; nodes?: FlowNode[]; edges?: FlowEdge[] } | null = null;
      for (const route of activeRoutes) {
        try {
          console.info("[ai-generate] fullJson attempt", route.name, route.model);
          const provider = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0, timeout: 60000 });
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: `${userPrompt}${formatInstr}` }], max_tokens: Math.max(8192, route.maxTokens), temperature: 0.2 });
          const text = result.choices[0]?.message?.content ?? "";
          if (!text) continue;
          graph = parseGraphJson(text);
          if (graph) break;
        } catch (error) { console.error("[ai-generate] fullJson pass failed", route.name, error instanceof Error ? error.message.slice(0, 200) : "unknown"); }
      }
      if (!graph) {
        controller.enqueue(encodeMessage(encoder, { type: "validation", errors: ["fullJson: the model did not return a parseable graph JSON"] }));
        return 0;
      }
      let graphName = graph.name;
      const loadGraph = (g: { nodes?: FlowNode[]; edges?: FlowEdge[] }) => {
        const rawNodes = g.nodes ?? [];
        const dropped = rawNodes.filter((n) => !(n?.id && n.data));
        if (dropped.length) console.warn("[ai-generate] fullJson dropped nodes without id/data:", dropped.length, "of", rawNodes.length, "first keys:", JSON.stringify(Object.keys((dropped[0] ?? {}) as object)));
        shadow.nodes = rawNodes.filter((n) => n?.id && n.data).map((n, i) => ({ ...n, position: (n as { position?: { x: number; y: number } }).position ?? { x: 120 + i * 260, y: 120 } }));
        const ids = new Set(shadow.nodes.map((n) => n.id));
        shadow.edges = (g.edges ?? [])
          .filter((e) => e?.source && e?.target && ids.has(e.source) && ids.has(e.target))
          .map((e) => ({ ...e, id: e.id ?? `e-${e.source}-${e.target}` }));
      };
      loadGraph(graph);
      for (let pass = 0; pass < 3; pass++) {
        const errors = computeErrors();
        if (!errors.length) break;
        console.warn("[ai-generate] fullJson validation errors", errors);
        const fixPrompt = `The workflow graph you generated has these DETERMINISTIC VALIDATION ERRORS:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nCurrent graph JSON:\n${JSON.stringify({ name: graphName, nodes: shadow.nodes, edges: shadow.edges })}\n\nRe-emit the COMPLETE corrected JSON object ({"name","nodes","edges"}), fixing exactly these errors. Keep node ids stable unless a node must be removed. Original request: ${userPrompt}`;
        let fixed = false;
        for (const route of activeRoutes) {
          try {
            console.info("[ai-generate] fullJson corrective attempt", route.name, route.model);
            const provider = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0, timeout: 60000 });
            const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: fixPrompt }], max_tokens: Math.max(8192, route.maxTokens), temperature: 0.2 });
            const text = result.choices[0]?.message?.content ?? "";
            const g = text ? parseGraphJson(text) : null;
            if (g) { loadGraph(g); if (g.name) graphName = g.name; fixed = true; break; }
          } catch (error) { console.error("[ai-generate] fullJson corrective failed", route.name, error instanceof Error ? error.message.slice(0, 200) : "unknown"); }
        }
        if (!fixed) break;
      }
      // Rebuild the shadow through the normal op path so the canvas draws
      // the final validated graph at the end (no incremental drawing).
      const finalNodes = shadow.nodes;
      const finalEdges = shadow.edges;
      if (!finalNodes.length) {
        console.error("[ai-generate] fullJson parsed graph had no usable nodes after corrective passes");
        controller.enqueue(encodeMessage(encoder, { type: "validation", errors: ["fullJson: el grafo parseado no tiene nodos utilizables tras los pases correctivos"] }));
        return 0;
      }
      shadow.nodes = [];
      shadow.edges = [];
      let count = 0;
      if (graphName) count = tryParseAndEnqueueOperation(JSON.stringify({ op: "setName", name: graphName }), encoder, controller, count, shadow);
      for (const n of finalNodes) count = tryParseAndEnqueueOperation(JSON.stringify({ op: "addNode", node: n }), encoder, controller, count, shadow);
      for (const e of finalEdges) count = tryParseAndEnqueueOperation(JSON.stringify({ op: "addEdge", edge: e }), encoder, controller, count, shadow);
      if (count === 0) {
        console.error("[ai-generate] fullJson synthesized ops all rejected");
        controller.enqueue(encodeMessage(encoder, { type: "validation", errors: ["fullJson: no se pudo materializar el grafo generado (ops rechazadas)"] }));
      }
      console.info("[ai-generate] fullJson materialized ops:", count, "nodes:", finalNodes.length, "edges:", finalEdges.length);
      return count;
    }
    // Tools mode (research 2026-10-22, Leo-approved): the model BUILDS the graph
    // through validated tool calls (add_node/connect/update_parameters/remove_node)
    // instead of emitting free-text JSONL that is repaired afterwards. Each call is
    // checked at the boundary (valid types, existing ids); the deterministic
    // validator battery stays as the final checker with up to 2 corrective rounds.
    async function runToolsGeneration(encoder: TextEncoder, controller: ReadableStreamDefaultController): Promise<number> {
      const sysPrompt = getSystemPrompt(composioCatalog, "tools");
      let localName = "";
      let lastModelText = "";
      let askedQuestion = "";
      // Wall-clock cap for the whole build (Leo 2026-10-22): a model that
      // cannot settle the validator errors must not spin forever - on expiry
      // we materialize what exists and the closing note says what is pending.
      const buildStart = Date.now();
      const buildCapMs = Number(process.env.AI_BUILD_CAP_MS) > 0 ? Number(process.env.AI_BUILD_CAP_MS) : 4 * 60 * 1000;
      const buildAbort = new AbortController();
      const buildTimer = setTimeout(() => buildAbort.abort(), buildCapMs);
      let timedOut = false;
      const mkTools = () => ({
        set_name: tool({
          description: "Set the workflow name and optional description. Call once, first.",
          inputSchema: z.object({ name: z.string(), description: z.string().optional() }),
          execute: async ({ name, description }) => { localName = name; shadowApply({ op: "setName", name }, shadow); if (description) shadowApply({ op: "setDescription", description }, shadow); return { ok: true }; },
        }),
        ask_user: tool({
          description: "Ask the user for missing information BEFORE building. Use when a value the flow needs is not provided and no earlier step can produce it. Do not build until they answer. Do NOT use when the user asked for a draft/mock (maqueta, ejemplo, prueba): use placeholders then.",
          inputSchema: z.object({ question: z.string().describe("the concrete question for the user, in Spanish, conversational") }),
          execute: async ({ question }) => { askedQuestion = question; return { ok: true }; },
        }),
        add_node: tool({
          description: "Add ONE node to the workflow. nodeType 'trigger' or 'action'; actionType is the trigger/action type; config carries the node settings.",
          inputSchema: z.object({ id: z.string().describe("unique kebab-case id"), nodeType: z.enum(["trigger", "action"]), label: z.string(), actionType: z.string(), config: z.record(z.string(), z.unknown()).optional() }),
          execute: async ({ id, nodeType, label, actionType, config }) => {
            const valid = nodeType === "trigger" ? getValidTriggerTypes() : getValidActionTypes();
            const match = [...valid].find(v => v === actionType || v.toLowerCase() === actionType.toLowerCase());
            if (!match) return { ok: false, error: `unknown ${nodeType} type "${actionType}". Valid types include: ${[...valid].slice(0, 50).join(", ")}` };
            const cfg = { ...(config ?? {}), ...(nodeType === "trigger" ? { triggerType: match } : { actionType: match }) };
            const ok = shadowApply({ op: "addNode", node: { id, type: nodeType, position: { x: 120 + shadow.nodes.length * 260, y: 120 }, data: { label, type: nodeType, config: cfg, status: "idle" } } }, shadow);
            return ok ? { ok: true } : { ok: false, error: `node id "${id}" already exists or is invalid - pick a new unique id` };
          },
        }),
        connect: tool({
          description: "Wire one node's output into another node's input. Both ids must already exist.",
          inputSchema: z.object({ source: z.string(), target: z.string() }),
          execute: async ({ source, target }) => {
            const ok = shadowApply({ op: "addEdge", edge: { source, target } }, shadow);
            return ok ? { ok: true } : { ok: false, error: `cannot connect ${source} -> ${target}: both nodes must already exist and the edge must not duplicate an existing one` };
          },
        }),
        update_parameters: tool({
          description: "Merge new config values into an existing node (fix or complete its settings).",
          inputSchema: z.object({ nodeId: z.string(), config: z.record(z.string(), z.unknown()) }),
          execute: async ({ nodeId, config }) => {
            const ok = shadowApply({ op: "updateNode", nodeId, updates: { data: { config } } }, shadow);
            return ok ? { ok: true } : { ok: false, error: `node "${nodeId}" does not exist` };
          },
        }),
        remove_node: tool({
          description: "Remove a wrong node and its wires.",
          inputSchema: z.object({ nodeId: z.string() }),
          execute: async ({ nodeId }) => { shadowApply({ op: "removeNode", nodeId }, shadow); return { ok: true }; },
        }),
      });
      const runOnce = async (fixErrors: string[]): Promise<void> => {
        for (const route of activeRoutes) {
          if (buildAbort.signal.aborted) { timedOut = true; break; }
          try {
            console.info("[ai-generate] tools attempt", route.name, route.model, fixErrors.length ? "(corrective)" : "");
            const started = Date.now();
            const messages: { role: "system" | "user"; content: string }[] = [{ role: "system", content: sysPrompt }];
            if (fixErrors.length) {
              const nodeList = shadow.nodes.map(n => `- ${n.id}: ${JSON.stringify({ label: n.data?.label, config: n.data?.config })}`).join("\n");
              const edgeList = shadow.edges.map(e => `- ${e.source} -> ${e.target}`).join("\n");
              messages.push({ role: "user", content: `The workflow built so far has these DETERMINISTIC VALIDATION ERRORS:\n${fixErrors.map(e => `- ${e}`).join("\n")}\n\nCurrent nodes:\n${nodeList}\nCurrent edges:\n${edgeList}\n\nFix exactly these errors with tool calls (update_parameters / connect / add_node / remove_node). Do NOT rebuild from scratch; reuse existing node ids. Original request: ${userPrompt}` });
            } else {
              messages.push({ role: "user", content: userPrompt });
            }
            const res = await generateText({ model: languageModel(route), messages, tools: mkTools(), stopWhen: stepCountIs(25), maxOutputTokens: Math.max(8192, route.maxTokens), temperature: 0.2, maxRetries: 0, abortSignal: buildAbort.signal });
            console.info("[ai-generate] tools usage", route.name, JSON.stringify(res.usage));
            trace.record(fixErrors.length ? "corrective" : "build", route, true, started);
            const outText = (res.text || "").trim();
            if (outText) lastModelText = outText;
            if (shadow.nodes.length > 0 || fixErrors.length) return;
          } catch (error) { trace.record(fixErrors.length ? "corrective" : "build", route, false, Date.now(), error); console.error("[ai-generate] tools pass failed", route.name, error instanceof Error ? error.message.slice(0, 240) : "unknown"); }
        }
      };
      // Deterministic repair: references into a Fórmula node's value need the
      // "result." wrapper the engine adds. Rewriting that mechanically is
      // cheaper and more reliable than spending a model round on a typo.
      const fixFormulaRefs = (): number => {
        let fixed = 0;
        const formulaIds = new Set(shadow.nodes.filter(n => (n.data as { config?: { actionType?: string } })?.config?.actionType === "Fórmula").map(n => n.id));
        if (!formulaIds.size) return 0;
        const walk = (val: unknown): unknown => {
          if (typeof val === "string") {
            return val.replace(/\{\{@([A-Za-z0-9_-]+):([^}:.]+)\.(?!result[.\[])([^}]+)\}\}/g, (m, id: string, label: string, rest: string) => {
              if (!formulaIds.has(id)) return m;
              fixed++;
              return `{{@${id}:${label}.result.${rest}}}`;
            });
          }
          if (Array.isArray(val)) return val.map(walk);
          if (val && typeof val === "object") { for (const [k, v] of Object.entries(val as Record<string, unknown>)) (val as Record<string, unknown>)[k] = walk(v); }
          return val;
        };
        for (const n of shadow.nodes) {
          const data = n.data as { config?: Record<string, unknown> } | undefined;
          if (data?.config) walk(data.config);
        }
        return fixed;
      };
      // Leo's rule: the build is finished; now tell the user, in the
      // conversation, what was built, what was assumed or is missing, and ask.
      // The closing note gets its own 60s cap: the build's time limit must
      // not trade one indefinite wait for another. If every route fails, the
      // caller falls back to a short state-aware line - never silence.
      const writeClosingNote = async (errs: string[], question: string, hitCap: boolean, builtState: string): Promise<string> => {
        const noteAbort = new AbortController();
        const noteTimer = setTimeout(() => noteAbort.abort(), 60 * 1000);
        try {
          for (const route of activeRoutes) {
            if (noteAbort.signal.aborted) break;
            try {
              const res = await generateText({
                model: languageModel(route),
                messages: [
                  { role: "system", content: "Sos el asistente que trabaja sobre el lienzo del usuario. Respondé en español, breve y conversacional." },
                  { role: "user", content: `Estado real del lienzo: ${builtState}.${errs.length ? ` Temas sin resolver: ${errs.join(" | ")}.` : ""}${question ? ` Antes de armar le pediste este dato al usuario: "${question}".` : ""}${hitCap ? " El armado se cortó por el tope de tiempo de seguridad." : ""} Escribí el mensaje para el usuario: describí el estado REAL del lienzo tal como te lo pasé (si no se construyó nada, decilo claramente; nunca afirmes que hay una base o pasos que no existen), contá qué asumiste o qué falta, y hacé la pregunta o propuesta que sigue. Nunca digas que no pudiste; nunca lo dejes sin respuesta. Pedido original: ${userPrompt}` },
                ],
                maxOutputTokens: 4096, temperature: 0.4, maxRetries: 0, abortSignal: noteAbort.signal,
              });
              const t = (res.text || "").trim();
              if (t) return t;
            } catch { /* next route */ }
          }
          return "";
        } finally { clearTimeout(noteTimer); }
      };
      await runOnce([]);
      // Leo's rule: if the model asked for missing data before building, the
      // question goes to the conversation and nothing is materialized yet.
      if (askedQuestion && !shadow.nodes.length) {
        clearTimeout(buildTimer);
        controller.enqueue(encodeMessage(encoder, { type: "question", text: askedQuestion }));
        return 0;
      }
      // Up to 2 corrective rounds, plus one extra when the only remaining
      // errors are consistency-class (e.g. an app the request explicitly
      // asks for is still missing) - those are worth one more shot.
      for (let round = 0; round < 3; round++) {
        if (buildAbort.signal.aborted || Date.now() > buildCapMs + buildStart) { timedOut = true; break; }
        const autoFixed = fixFormulaRefs();
        if (autoFixed) console.info("[ai-generate] tools auto-fixed Fórmula refs:", autoFixed);
        const errs = computeErrors();
        if (!errs.length) break;
        if (round >= 2 && !errs.some(e => e.startsWith("consistencia:"))) break;
        console.warn("[ai-generate] tools corrective round", round + 1, errs);
        await runOnce(errs);
      }
      clearTimeout(buildTimer);
      if (buildAbort.signal.aborted) timedOut = true;
      if (timedOut) console.warn("[ai-generate] tools build hit the wall-clock cap; materializing what exists");
      const finalNodes = shadow.nodes;
      const finalEdges = shadow.edges;
      if (!finalNodes.length) {
        if (timedOut) {
          let note = await writeClosingNote(computeErrors(), askedQuestion, true, "no se construyó ningún paso (el lienzo quedó vacío)");
          if (!note) note = "El armado se cortó por el tope de tiempo de seguridad y no llegué a construir nada en el lienzo. ¿Lo intentamos de nuevo?";
          controller.enqueue(encodeMessage(encoder, { type: "summary", text: note }));
        }
        controller.enqueue(encodeMessage(encoder, { type: "validation", errors: ["tools: the model did not build any nodes"] }));
        return 0;
      }
      shadow.nodes = [];
      shadow.edges = [];
      let count = 0;
      if (localName) count = tryParseAndEnqueueOperation(JSON.stringify({ op: "setName", name: localName }), encoder, controller, count, shadow);
      for (const n of finalNodes) count = tryParseAndEnqueueOperation(JSON.stringify({ op: "addNode", node: n }), encoder, controller, count, shadow);
      for (const e of finalEdges) count = tryParseAndEnqueueOperation(JSON.stringify({ op: "addEdge", edge: e }), encoder, controller, count, shadow);
      console.info("[ai-generate] tools materialized ops:", count, "nodes:", finalNodes.length, "edges:", finalEdges.length);
      const remainingAfter = computeErrors();
      const builtState = `${finalNodes.length} paso(s) materializados: ${finalNodes.slice(0, 10).map(n => String((n.data as { label?: string })?.label ?? n.id)).join(", ")}`;
      let closing = lastModelText;
      if (remainingAfter.length || askedQuestion || !closing || timedOut) {
        const note = await writeClosingNote(remainingAfter, askedQuestion, timedOut, builtState);
        if (note) closing = note;
        else if (timedOut) closing = `El armado se cortó por el tope de tiempo de seguridad. En el lienzo quedaron ${builtState}, pero el flujo no está terminado. ¿Lo retomamos desde acá?`;
      }
      if (closing) controller.enqueue(encodeMessage(encoder, { type: "summary", text: closing }));
      return count;
    }
    const stream = new ReadableStream({ async start(controller) { try { let operationCount = 0;
          if (builderMode === "tools" && !existingWorkflow) {
            operationCount = await runToolsGeneration(encoder, controller);
          } else if (evalMode === "fullJson" && !existingWorkflow) {

            operationCount = await runFullJsonGeneration(encoder, controller);
          } else {
            operationCount = await processOperationStream(textChunks(), encoder, controller, shadow); if (streamState.truncated) operationCount = await runContinuationPass(operationCount, encoder, controller); for (let pass = 0; pass < 4; pass++) {
              const remaining = computeErrors();
              if (!remaining.length) break;
              const structural = remaining.filter(e => /Loop|per-item|raw list|crosses TWO|compare\/cross|list-crossing/i.test(e));
              const hint = pass >= 2 && structural.length
                ? "\n\nHINT for the list-processing errors: replace any Fórmula/AI step that reads two lists with ONE Loop node shaped exactly like this: {\"actionType\": \"Loop\", \"source\": \"{{@<list-node-id>:<Label>.<arrayField>}}\", \"maxItems\": 50, \"steps\": [{\"id\": \"check\", \"actionType\": \"Condition\", \"config\": {\"condition\": \"{{@item:Item.<field>}} <comparison> <value>\"}}, {\"id\": \"act\", \"actionType\": \"<the write/notify action>\", \"config\": {...}}]} - a false inner Condition FILTERS the item, and aggregate/notify steps go AFTER the Loop referencing {{@<loop-id>:<Label>.count}} or .items. Keep every inner step's parameters inside its \"config\" object."
                : "";
              operationCount = await runCorrectivePass(operationCount, encoder, controller, hint);
            }
          }
          // Deterministic cleanup: remove unreachable action nodes that nothing references
          // (leftovers a corrective pass replaced but did not remove).
          for (let sweep = 0; sweep < 3; sweep++) {
            const triggerIds = shadow.nodes.filter(n => n.type === "trigger" || (n.data as { type?: string })?.type === "trigger").map(n => n.id);
            const reachable = new Set<string>(triggerIds);
            const queue = [...triggerIds];
            while (queue.length) { const c = queue.pop() as string; for (const e of shadow.edges) if (e.source === c && !reachable.has(e.target)) { reachable.add(e.target); queue.push(e.target); } }
            const orphans = shadow.nodes.filter(n => !reachable.has(n.id));
            if (!orphans.length) break;
            const referenced = new Set<string>();
            // Refs inside a Loop's inner steps resolve within the loop body first:
            // an inner step id must not protect a top-level orphan that shares it.
            for (const n of shadow.nodes) {
              const nodeData = n.data as { config?: Record<string, unknown> } | undefined;
              const cfg = nodeData?.config;
              const steps = cfg && Array.isArray(cfg.steps) ? (cfg.steps as { id?: string; config?: unknown }[]) : null;
              const innerIds = new Set((steps ?? []).map(s => s?.id).filter((v): v is string => typeof v === "string"));
              const outerTxt = JSON.stringify(steps ? { ...(nodeData ?? {}), config: { ...(cfg ?? {}), steps: undefined } } : (nodeData ?? {}));
              for (const m of outerTxt.matchAll(/\{\{@([\w-]+):/g)) referenced.add(m[1]);
              if (steps) for (const st of steps) { const stTxt = JSON.stringify(st?.config ?? {}); for (const m of stTxt.matchAll(/\{\{@([\w-]+):/g)) if (!innerIds.has(m[1])) referenced.add(m[1]); }
            }
            const removable = orphans.filter(o => !referenced.has(o.id) && !shadow.edges.some(e => e.source === o.id && reachable.has(e.target)));
            if (!removable.length) break;
            for (const o of removable) { console.warn("[ai-generate] removing unreachable orphan node", o.id); operationCount = tryParseAndEnqueueOperation(JSON.stringify({ op: "removeNode", nodeId: o.id }), encoder, controller, operationCount, shadow); }
          }
          // Deterministic label normalization: nodes backed by a plugin must show
          // the app name in their label (user-facing clarity + label_contains evals).
          {
            const APP_LABELS: Record<string, string> = {
              tiendanube: "Tiendanube", mercadolibre: "Mercado Libre", whatsapp: "WhatsApp",
              slack: "Slack", zipnova: "Zipnova", stripe: "Stripe", github: "GitHub",
              linear: "Linear", mercadopago: "Mercado Pago",
            };
            for (const n of shadow.nodes) {
              const cfg = (n.data as { config?: Record<string, unknown> })?.config ?? {};
              const typeId = String(cfg.actionType ?? cfg.triggerType ?? "");
              const app = APP_LABELS[typeId.split("/")[0]];
              if (!app) continue;
              const data = n.data as { label?: string };
              const label = data.label ?? "";
              const norm = (t: string) => t.toLowerCase().replace(/[\s_-]/g, "");
              if (norm(label).includes(norm(app))) continue;
              const newLabel = label ? `${label} - ${app}` : app;
              console.info("[ai-generate] label normalized", n.id, "->", newLabel);
              operationCount = tryParseAndEnqueueOperation(JSON.stringify({ op: "updateNode", nodeId: n.id, updates: { data: { label: newLabel } } }), encoder, controller, operationCount, shadow);
            }
          }
          // Deterministic dedupe: a top-level node that shares its id with a Loop inner step is a
          // duplicate the model emitted (its {{@item:...}} refs only resolve inside the Loop).
          // Remove it and rewire its incoming edges to the Loop, its outgoing edges from the Loop.
          {
            const innerIdToLoop = new Map<string, string>();
            for (const n of shadow.nodes) {
              const steps = (n.data as { config?: { steps?: { id?: string }[] } })?.config?.steps;
              if (Array.isArray(steps)) for (const s of steps) if (typeof s?.id === "string") innerIdToLoop.set(s.id, n.id);
            }
            for (const n of [...shadow.nodes]) {
              const loopId = innerIdToLoop.get(n.id);
              if (!loopId || loopId === n.id) continue;
              if (n.type === "trigger" || (n.data as { type?: string })?.type === "trigger") continue;
              console.warn("[ai-generate] removing duplicate top-level node of Loop inner step", n.id, "->", loopId);
              for (const e of shadow.edges) { if (e.target === n.id) e.target = loopId; if (e.source === n.id) e.source = loopId; }
              operationCount = tryParseAndEnqueueOperation(JSON.stringify({ op: "removeNode", nodeId: n.id }), encoder, controller, operationCount, shadow);
            }
          }
          // Deterministic auto-layout (dagre): node positions come from the graph,
          // not from the model. Applied only to workflows that started empty; on
          // edits the user's existing arrangement is preserved.
          if (startedEmpty && shadow.nodes.length) {
            const positions = layoutPositions(shadow.nodes, shadow.edges);
            for (const n of shadow.nodes) {
              const pos = positions.get(n.id);
              if (!pos) continue;
              operationCount = tryParseAndEnqueueOperation(JSON.stringify({ op: "updateNode", nodeId: n.id, updates: { position: pos } }), encoder, controller, operationCount, shadow);
            }
          } const remaining = computeErrors(); if (remaining.length) { console.warn("[ai-generate] validation errors remain after retries", remaining); controller.enqueue(encodeMessage(encoder, { type: "validation", errors: remaining })); } controller.enqueue(encodeMessage(encoder, { type: "trace", trace: trace.summary() })); if (trace.strict && !trace.entries.some(x => x.ok)) { const f = trace.entries[trace.entries.length - 1]; controller.enqueue(encodeMessage(encoder, { type: "error", error: `El modelo elegido (${f ? `${f.route}/${f.model}` : selection.choice}) no respondió${f?.status ? ` (${f.status})` : ""}. No se usó ningún otro modelo.` })); } controller.enqueue(encodeMessage(encoder, { type: "complete" })); controller.close(); } catch (error) { controller.enqueue(encodeMessage(encoder, { type: "error", error: error instanceof Error ? error.message : "Failed to generate workflow" })); controller.close(); } } });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  } catch (error) { console.error("Failed to generate workflow:", error instanceof Error ? error.message.slice(0, 240) : "unknown"); return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate workflow" }, { status: 500 }); }
}
