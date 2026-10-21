import { llmRoutes } from "@/lib/free-models";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateAIActionPrompts } from "@/plugins";
import { getActionOutputFields, getAllActions } from "@/plugins/registry";
import { type FlowEdge, type FlowNode, planCoverageError, requestCoverageError, validateFlow } from "@/lib/flow-validator";
import { discoverComposio } from "@/plugins/composio/steps/catalog";

type Operation = {
  op: "setName" | "setDescription" | "addNode" | "addEdge" | "removeNode" | "removeEdge" | "updateNode";
  name?: string; description?: string; node?: unknown; edge?: unknown; nodeId?: string; edgeId?: string;
  updates?: { position?: { x: number; y: number }; data?: unknown };
};

type Shadow = { nodes: FlowNode[]; edges: FlowEdge[] };
function shadowApply(operation: Operation, shadow: Shadow): boolean {
  if (operation.op === "addNode") {
    const node = operation.node as FlowNode | undefined;
    if (!node?.id || !node.data) return false;
    if (shadow.nodes.some((n) => n.id === node.id)) return false;
    shadow.nodes.push(node);
    return true;
  }
  if (operation.op === "addEdge") {
    const edge = operation.edge as FlowEdge | undefined;
    if (!edge?.source || !edge?.target) return false;
    const ids = new Set(shadow.nodes.map((n) => n.id));
    if (!ids.has(edge.source) || !ids.has(edge.target)) return false;
    if (shadow.edges.some((e) => e.source === edge.source && e.target === edge.target)) return false;
    if (!edge.id) edge.id = `e-${edge.source}-${edge.target}`;
    shadow.edges.push(edge);
    return true;
  }
  if (operation.op === "removeNode" && operation.nodeId) {
    shadow.nodes = shadow.nodes.filter((n) => n.id !== operation.nodeId);
    shadow.edges = shadow.edges.filter((e) => e.source !== operation.nodeId && e.target !== operation.nodeId);
    return true;
  }
  if (operation.op === "removeEdge" && operation.edgeId) {
    shadow.edges = shadow.edges.filter((e) => e.id !== operation.edgeId);
    return true;
  }
  if (operation.op === "updateNode" && operation.nodeId) {
    shadow.nodes = shadow.nodes.map((n) => n.id === operation.nodeId ? { ...n, ...(operation.updates?.position ? { position: operation.updates.position } : {}), ...(operation.updates?.data ? { data: { ...n.data, ...(operation.updates.data as object) } } : {}) } as FlowNode : n);
    return true;
  }
  return operation.op === "setName" || operation.op === "setDescription";
}
function encodeMessage(encoder: TextEncoder, message: object): Uint8Array { return encoder.encode(`${JSON.stringify(message)}\n`); }
function shouldSkipLine(line: string): boolean { const trimmed = line.trim(); return !trimmed || trimmed.startsWith("```"); }
function tryParseAndEnqueueOperation(line: string, encoder: TextEncoder, controller: ReadableStreamDefaultController, operationCount: number, shadow: Shadow): number {
  const trimmed = line.trim(); if (shouldSkipLine(line)) return operationCount;
  try { const operation = JSON.parse(trimmed) as Operation; if (!shadowApply(operation, shadow)) { console.warn("[API] op rejected by guard:", operation.op, trimmed.substring(0, 80)); return operationCount; } const newCount = operationCount + 1; console.log(`[API] Operation ${newCount}:`, operation.op); controller.enqueue(encodeMessage(encoder, { type: "operation", operation })); return newCount; }
  catch { console.warn("[API] Skipping invalid JSON line:", trimmed.substring(0, 50)); return operationCount; }
}
function processBufferLines(buffer: string, encoder: TextEncoder, controller: ReadableStreamDefaultController, operationCount: number, shadow: Shadow): { remainingBuffer: string; newOperationCount: number } {
  const lines = buffer.split("\n"); const remainingBuffer = lines.pop() || ""; let newOperationCount = operationCount;
  for (const line of lines) newOperationCount = tryParseAndEnqueueOperation(line, encoder, controller, newOperationCount, shadow);
  return { remainingBuffer, newOperationCount };
}
async function processOperationStream(textStream: AsyncIterable<string>, encoder: TextEncoder, controller: ReadableStreamDefaultController, shadow: Shadow): Promise<number> {
  let buffer = ""; let operationCount = 0; let chunkCount = 0; let charCount = 0;
  for await (const chunk of textStream) { chunkCount += 1; charCount += chunk.length; buffer += chunk; const result = processBufferLines(buffer, encoder, controller, operationCount, shadow); buffer = result.remainingBuffer; operationCount = result.newOperationCount; }
  operationCount = tryParseAndEnqueueOperation(buffer, encoder, controller, operationCount, shadow);
  console.log("[ai-generate] stream complete", { chunkCount, charCount, operationCount });
  if (operationCount === 0) throw new Error(chunkCount === 0 ? "The free AI model returned nothing (it may be busy). Your prompt was kept. Try again in a moment." : "The AI answered, but not in a form that could change the workflow. Your prompt was kept. Try rephrasing it.");
  return operationCount;
}
function getSystemPrompt(composioCatalog = ""): string {
  const pluginActionPrompts = generateAIActionPrompts();
  return `You are a workflow automation expert. Generate a workflow based on the user's description.

${composioCatalog}

CRITICAL: Output your workflow as INDIVIDUAL OPERATIONS, one per line in JSONL format.
Each line must be a complete, separate JSON object.

Operations you can output:
1. {"op": "setName", "name": "Workflow Name"}
2. {"op": "setDescription", "description": "Brief description"}
3. {"op": "addNode", "node": {COMPLETE_NODE_OBJECT}}
4. {"op": "addEdge", "edge": {COMPLETE_EDGE_OBJECT}}
5. {"op": "removeNode", "nodeId": "node-id-to-remove"}
6. {"op": "removeEdge", "edgeId": "edge-id-to-remove"}
7. {"op": "updateNode", "nodeId": "node-id", "updates": {"position": {"x": 100, "y": 200}}}

IMPORTANT RULES:
- Every workflow must have EXACTLY ONE trigger node
- Output ONE operation per line
- Each line must be complete, valid JSON
- Start with setName and setDescription
- Then add nodes one at a time
- Finally add edges one at a time to CONNECT ALL NODES
- CRITICAL: Every node (except the last) MUST be connected to at least one other node
- To update node positions or properties, use updateNode operation
- NEVER output explanatory text - ONLY JSON operations
- Do NOT wrap in markdown code blocks
- Do NOT add explanatory text

Node structure:
{
  "id": "unique-id",
  "type": "trigger" or "action",
  "position": {"x": number, "y": number},
  "data": {
    "label": "Node Label",
    "description": "Node description",
    "type": "trigger" or "action",
    "config": {...},
    "status": "idle"
  }
}

NODE POSITIONING RULES:
- Nodes are squares, so use equal spacing in both directions
- Horizontal spacing between sequential nodes: 250px (e.g., x: 100, then x: 350, then x: 600)
- Vertical spacing for parallel branches: 250px (e.g., y: 75, y: 325, y: 575)
- Start trigger node at position {"x": 100, "y": 200}
- For linear workflows: increment x by 250 for each subsequent node, keep y constant
- For branching workflows: keep x the same for parallel branches, space y by 250px per branch
- When adding nodes to existing workflows, position new nodes 250px away from existing nodes

Trigger types:
- Manual: {"triggerType": "Manual"}
- Webhook: {"triggerType": "Webhook", "webhookPath": "/webhooks/name", ...}
- Schedule: {"triggerType": "Schedule", "scheduleCron": "0 9 * * *", ...}

System action types (built-in):
- Database Query: {"actionType": "Database Query", "dbQuery": "SELECT * FROM table", "dbTable": "table"}
- HTTP Request: {"actionType": "HTTP Request", "httpMethod": "POST", "endpoint": "https://api.example.com", "httpHeaders": "{}", "httpBody": "{}"}
- Condition: {"actionType": "Condition", "condition": "{{@nodeId:Label.field}} === 'value'"}
- Delay: {"actionType": "Delay", "durationMinutes": 10} — pauses the workflow durably before continuing (use "durationSeconds" for sub-minute waits). NEVER simulate a wait with an HTTP Request to an external service.
- Approval: {"actionType": "Approval", "message": "..."} — pauses the run until a person approves or rejects it from the runs view (human-in-the-loop). Use it whenever the user should review, choose or authorize something before the flow continues (e.g. picking one of N generated options, authorizing a publication or a purchase). A rejection ends the run. Later steps can reference {{@node-id:Label.approved}} and {{@node-id:Label.note}}. When the user asks to be presented options to review or choose from, use this node for that step (never a messaging app they did not ask for).
- Fórmula: {"actionType": "Fórmula", "input": "{\"precio\": 100}", "expression": "precio * 1.21"} — evaluates a JSONata expression over the JSON input; use it to transform, calculate, filter or reshape data between steps. "input" is a JSON string that may contain {{@...}} templates; "expression" is plain JSONata (no {{@...}} templates inside).

Plugin action types (from integrations):
${pluginActionPrompts}

WIRING DATA BETWEEN STEPS (CRITICAL):
- When a step needs a value produced by an earlier step (an ID, a reference, a status, a name, a total), NEVER invent a value, NEVER use a placeholder, and NEVER leave it for the user to fill. Reference the earlier step's output with a template: {{@node-id:Node Label.field.path}} where node-id is the exact id you gave that node and field.path walks its output fields (standard outputs unwrap automatically, so use the field names from the action's output list, e.g. {{@search-orders:Search Orders.orders}}).
- Arrays: a specific element can be referenced with [index], e.g. {{@search-orders:Search Orders.orders[0].id}}.
- LOOPS (repeat steps per list item): use an action node with {"actionType": "Loop", "source": "{{@node-id:Node Label.arrayField}}", "maxItems": 50, "steps": [...]}. "source" must be a template pointing to an ARRAY field of an earlier step. "steps" is a linear chain of 1-3 inner steps, each {"id": "kebab-id", "actionType": "<any action>", "config": {...}} with the same config shape a normal node uses - ALL parameters of an inner step MUST go inside its "config" object, never at the step's top level; they run once per item, in order. Inside inner step configs, reference the current item with {{@item:Item.field.path}} and its position with {{@index:Index.number}}; inner steps can also reference earlier inner steps by their id ({{@check-payment:Check Payment.field}}) and earlier canvas nodes normally. The Loop node's output: results (last inner step's output per completed item), items (one entry per completed item: {"index", "item", "steps": {"<inner-step-id with non-alphanumerics as _>": that step's output}} - use {{@loop-id:Label.items}} when a later step needs data from EVERY inner step per item, e.g. both the order detail and its payment), failed (items that failed, with their index and error), count, completed, failedCount. Items that fail are skipped and the run continues. A Condition as an inner step FILTERS the item: when it is false, the remaining inner steps are skipped for that item and the item is excluded from results (counted in filteredCount), without failing the run. Example per-item payment check: source {{@search-orders:Search Orders.orders}}, one inner step {"id": "check-payment", "actionType": "Search Payments", "config": {"externalReference": "{{@item:Item.id}}"}}. If one AI summary over the whole list serves the request, prefer that simpler whole-list version; use Loop when the user asks to process each item individually.
- Conditions MUST compare template references or fixed values only (e.g. {{@get-order:Get Order.status}} === 'paid'). Invented variables like orderResult.status are invalid.
- When a text or prompt field needs an object or array, reference the whole output or field; it is inserted as JSON.

CRITICAL ABOUT CONDITION NODES:
- Condition nodes evaluate a boolean expression
- When TRUE: ALL connected nodes execute
- When FALSE: ALL connected nodes are SKIPPED
- For if/else logic, CREATE MULTIPLE SEPARATE condition nodes (one per branch)
- NEVER connect multiple different outcome paths to a single condition node
- Each condition should check for ONE specific case

For "only if X do Y, then continue with Z either way": create TWO conditions (X and NOT X); connect X -> Y -> Z and NOT X -> Z. NEVER connect a Condition to both Y and a downstream Z: when it is false, everything connected is skipped and the flow dies.

Example: "if good send Slack, if bad create ticket" needs TWO conditions:
{"op": "addNode", "node": {"id": "cond-good", "data": {"config": {"condition": "{{@rate:Rate.value}} === 'good'"}}}}
{"op": "addNode", "node": {"id": "cond-bad", "data": {"config": {"condition": "{{@rate:Rate.value}} === 'bad'"}}}}
{"op": "addEdge", "edge": {"source": "rate", "target": "cond-good"}}
{"op": "addEdge", "edge": {"source": "rate", "target": "cond-bad"}}
{"op": "addEdge", "edge": {"source": "cond-good", "target": "slack"}}
{"op": "addEdge", "edge": {"source": "cond-bad", "target": "ticket"}}

PLANNING RULES (IMPORTANT):
- Independent first steps with no dependency between them MUST be parallel branches from the trigger, never chained in series (e.g. a "get product" and a "get item" both connect from the trigger; their results join at the first step that needs both).
- N similar outputs from a list (e.g. "generate 3 videos from the 3 chosen scripts") MUST be ONE Loop node with a single inner step, never N separate nodes. The step that produces the list must output STRUCTURED data (an array), so when using an AI text step to produce it, ask it for JSON object output with an array field (use the action's structured/object format when it has one) and point the Loop's source at that array.
- Market, competitor or web research MUST use the Perplexity research action when it is available in the plugin list (it has live web access). Never simulate research with a plain text-generation step.
- Per-item alerts ("if any item is X, notify"): put the Condition INSIDE the Loop as an inner step right after the per-item check, and the notify action as the LAST inner step. A false inner Condition filters that item, so the alert fires only for matching items. Example for "for each order item check stock and if it hit zero alert Slack": Loop {"source": "{{@get-order:Get Order.products}}", "steps": [{"id": "check-product", "actionType": "tiendanube/get-product", "config": {"productId": "{{@item:Item.id}}"}}, {"id": "stock-zero", "actionType": "Condition", "config": {"condition": "{{@check-product:Check Product.stock}} === 0"}}, {"id": "alert", "actionType": "slack/send-message", "config": {"channel": "#deposito", "text": "Sin stock: {{@item:Item.name}}"}}]}. NEVER express a per-item condition as a top-level Condition over the Loop's results.
- Apps with a listed action: if the app the user names has an action in the plugin list above or in the live Composio catalog, you MUST use that action. NEVER hand-roll an HTTP Request node to that app's API, and NEVER invent its endpoint. HTTP Request is only for apps with NO available action (like WordPress).
- WordPress: there is no native WordPress action. To publish or edit WordPress content, use an HTTP Request node against the site's REST API. Example (create a post): {"actionType": "HTTP Request", "httpMethod": "POST", "endpoint": "https://<site>/wp-json/wp/v2/posts", "httpHeaders": "{\"Authorization\": \"Basic <base64(usuario:application-password)>\", \"Content-Type\": \"application/json\"}", "httpBody": "{\"title\": ..., \"content\": ..., \"status\": \"publish\"}"}. Auth is HTTP Basic with a WordPress Application Password. NEVER ask for the username or application password in the chat and never invent one: leave the placeholder in httpHeaders and note that the user completes the credential in the node's config panel.
- If the user asks to be presented options to review or choose from, ALWAYS end the workflow with a final presentation step that lists every option clearly (title, content, why it was chosen, and link or media).
- Every edge endpoint MUST be the id of a node you actually emitted in this response. Never create an edge to or from a node that does not exist.
- Template references MUST use only the output field names listed after "outputs:" for that action in the plugin list above (e.g. if the action lists "outputs: report, citations", {{@node-id:Label.report}} is valid and {{@node-id:Label.answer}} is not). For steps with structured/object format enabled, reference the object field; for plain text format, the text field.

Edge structure:
{
  "id": "edge-id",
  "source": "source-node-id",
  "target": "target-node-id",
  "type": "default"
}

WORKFLOW FLOW:
- Trigger connects to first action
- Actions connect in sequence or to multiple branches
- ALWAYS create edges to connect the workflow flow
- For linear workflows: trigger -> action1 -> action2 -> etc
- For branching (conditions): one source can connect to multiple targets

Example output (linear workflow with 250px horizontal spacing):
{"op": "setName", "name": "Contact Form Workflow"}
{"op": "setDescription", "description": "Processes contact form submissions"}
{"op": "addNode", "node": {"id": "trigger-1", "type": "trigger", "position": {"x": 100, "y": 200}, "data": {"label": "Contact Form", "type": "trigger", "config": {"triggerType": "Manual"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "send-email", "type": "action", "position": {"x": 350, "y": 200}, "data": {"label": "Send Email", "type": "action", "config": {"actionType": "Send Email", "emailTo": "admin@example.com", "emailSubject": "New Contact", "emailBody": "New contact form submission"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "log-action", "type": "action", "position": {"x": 600, "y": 200}, "data": {"label": "Log Result", "type": "action", "config": {"actionType": "HTTP Request", "httpMethod": "POST", "endpoint": "https://api.example.com/log"}, "status": "idle"}}}
{"op": "addEdge", "edge": {"id": "e1", "source": "trigger-1", "target": "send-email", "type": "default"}}
{"op": "addEdge", "edge": {"id": "e2", "source": "send-email", "target": "log-action", "type": "default"}}

Example output (branching workflow with 250px vertical spacing):
{"op": "addNode", "node": {"id": "trigger-1", "type": "trigger", "position": {"x": 100, "y": 200}, "data": {"label": "Webhook", "type": "trigger", "config": {"triggerType": "Webhook"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "branch-a", "type": "action", "position": {"x": 350, "y": 75}, "data": {"label": "Branch A", "type": "action", "config": {"actionType": "Send Email"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "branch-b", "type": "action", "position": {"x": 350, "y": 325}, "data": {"label": "Branch B", "type": "action", "config": {"actionType": "Send Slack Message"}, "status": "idle"}}}
{"op": "addEdge", "edge": {"id": "e1", "source": "trigger-1", "target": "branch-a", "type": "default"}}
{"op": "addEdge", "edge": {"id": "e2", "source": "trigger-1", "target": "branch-b", "type": "default"}}

REMEMBER: After adding all nodes, you MUST add edges to connect them! Every node should be reachable from the trigger.`;
}


const SYSTEM_ACTION_TYPES = ["Database Query", "HTTP Request", "Condition", "Delay", "Fórmula", "Loop", "Approval"];
let cachedValidActionTypes: Set<string> | null = null;
function getValidActionTypes(): Set<string> {
  if (!cachedValidActionTypes) {
    cachedValidActionTypes = new Set(SYSTEM_ACTION_TYPES);
    for (const a of getAllActions()) { cachedValidActionTypes.add(a.id); if (a.label) cachedValidActionTypes.add(a.label); }
  }
  return cachedValidActionTypes;
}


export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || session.user.isAnonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json(); const { prompt, existingWorkflow } = body;
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    if (!llmRoutes().length) return NextResponse.json({ error: "AI API key not configured on server." }, { status: 500 });
    let composioCatalog = "";
    const toolkitPatterns: Record<string, RegExp> = { outlook: /outlook|hotmail|microsoft/i, gmail: /gmail|e-?mail|mail/i, slack: /slack/i, notion: /notion/i, airtable: /airtable/i, googlesheets: /sheets|spreadsheet|planilla/i, googledrive: /drive/i, github: /github/i, linear: /linear/i, stripe: /stripe/i, hubspot: /hubspot/i, jira: /jira/i, hackernews: /hacker\s*news/i };
    const promptText = String(prompt);
    const requestedToolkits = Object.keys(toolkitPatterns).filter(k => toolkitPatterns[k].test(promptText)).slice(0, 4);
    if (requestedToolkits.length && !/REAL COMPOSIO ACTIONS/.test(promptText)) {
      const results = await Promise.all(requestedToolkits.map(async toolkit => { try { return { toolkit, result: await discoverComposio({ catalog: "tools", toolkit }) }; } catch (error) { console.error("[ai-generate] Composio catalog lookup failed", toolkit, error instanceof Error ? error.message : "unknown"); return null; } }));
      const compact = (tool: Record<string, unknown>, toolkit: string) => {
        const params = (tool.input_parameters ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
        return { toolkit, slug: tool.slug, name: tool.name, description: String(tool.description ?? "").slice(0, 120), required: params.required ?? [], params: Object.keys(params.properties ?? {}).slice(0, 12) };
      };
      let actions = results.flatMap(entry => entry?.result?.items?.map((tool: Record<string, unknown>) => compact(tool, entry.toolkit)) ?? []);
      let json = JSON.stringify(actions);
      while (json.length > 40000 && actions.length > 1) { actions = actions.slice(0, Math.floor(actions.length * 0.8)); json = JSON.stringify(actions); }
      console.info("[ai-generate] catalog size", { toolkits: requestedToolkits, actions: actions.length, chars: json.length });
      composioCatalog = actions.length ? `LIVE COMPOSIO ACTION CATALOG (exact slugs; use only these):\n${json}` : "No live Composio action catalog was available. Do not invent Composio actions.";
    }
    let userPrompt = prompt;
    if (existingWorkflow) {
      const nodesList = (existingWorkflow.nodes || []).map((n: { id: string; data?: { label?: string } }) => `- ${n.id} (${n.data?.label || "Unlabeled"})`).join("\n");
      const edgesList = (existingWorkflow.edges || []).map((e: { id: string; source: string; target: string }) => `- ${e.id}: ${e.source} -> ${e.target}`).join("\n");
      userPrompt = `I have an existing workflow. Make ONLY the changes requested.\nCurrent workflow nodes:\n${nodesList}\nCurrent workflow edges:\n${edgesList}\nFull workflow data (do not recreate existing nodes):\n${JSON.stringify(existingWorkflow, null, 2)}\nUser request: ${prompt}\nOutput only operations needed. Add new edges after nodes. Use existing node ids; avoid overlaps; preserve structure.`;
    }
    async function* textChunks() {
      const failures: string[] = [];
      const safeSummary = (error: unknown) => (error instanceof Error ? error.message : "unknown error").replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]").replace(/(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})/g, "[redacted-key]").slice(0, 240);
      for (const route of llmRoutes()) {
        let got = false;
        try {
          console.info("[ai-generate] provider attempt", route.name, route.model);
          const provider = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0, timeout: 15000 });
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: userPrompt }], stream: true, max_tokens: 8192 });
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
    const computeErrors = (): string[] => {
      const errs = validateFlow(shadow.nodes, shadow.edges, getActionOutputFields(), getValidActionTypes());
      const coverage = planCoverageError(userPrompt, shadow.nodes);
      if (coverage) errs.push(coverage);
      const appCoverage = requestCoverageError(userPrompt, shadow.nodes);
      if (appCoverage) errs.push(appCoverage);
      return errs;
    };
    async function runCorrectivePass(operationCount: number, encoder: TextEncoder, controller: ReadableStreamDefaultController): Promise<number> {
      const errors = computeErrors();
      if (!errors.length) return operationCount;
      console.warn("[ai-generate] validation errors", errors);
      const nodeList = shadow.nodes.map(n => `- ${n.id} (${n.data?.label ?? ""} / ${String(n.data?.config?.actionType ?? n.data?.type ?? "")})`).join("\n");
      const edgeList = shadow.edges.map(e => `- ${e.source} -> ${e.target}`).join("\n");
      const fixPrompt = `The workflow you generated has these DETERMINISTIC VALIDATION ERRORS:\n${errors.map(e => `- ${e}`).join("\n")}\n\nCurrent nodes:\n${nodeList}\nCurrent edges:\n${edgeList}\n\nEmit ONLY the corrective operations needed to fix these exact errors (addNode/addEdge/removeNode/removeEdge/updateNode). Add nodes before the edges that use them. Do NOT recreate existing nodes; reuse their exact ids. Original request: ${userPrompt}`;
      for (const route of llmRoutes()) {
        try {
          console.info("[ai-generate] corrective attempt", route.name, route.model);
          const provider = new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL, maxRetries: 0, timeout: 20000 });
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: fixPrompt }], max_tokens: 4096 });
          const text = result.choices[0]?.message?.content ?? "";
          if (!text) continue;
          let count = operationCount;
          for (const line of text.split("\n")) count = tryParseAndEnqueueOperation(line, encoder, controller, count, shadow);
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
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: contPrompt }], max_tokens: 8192 });
          const text = result.choices[0]?.message?.content ?? "";
          if (!text) continue;
          let count = operationCount;
          for (const line of text.split("\n")) count = tryParseAndEnqueueOperation(line, encoder, controller, count, shadow);
          return count;
        } catch (error) { console.error("[ai-generate] continuation pass failed", route.name, error instanceof Error ? error.message.slice(0, 200) : "unknown"); }
      }
      return operationCount;
    }
    const stream = new ReadableStream({ async start(controller) { try { let operationCount = await processOperationStream(textChunks(), encoder, controller, shadow); if (streamState.truncated) operationCount = await runContinuationPass(operationCount, encoder, controller); for (let pass = 0; pass < 2; pass++) { if (!computeErrors().length) break; operationCount = await runCorrectivePass(operationCount, encoder, controller); } const remaining = computeErrors(); if (remaining.length) { console.warn("[ai-generate] validation errors remain after retries", remaining); controller.enqueue(encodeMessage(encoder, { type: "validation", errors: remaining })); } controller.enqueue(encodeMessage(encoder, { type: "complete" })); controller.close(); } catch (error) { controller.enqueue(encodeMessage(encoder, { type: "error", error: error instanceof Error ? error.message : "Failed to generate workflow" })); controller.close(); } } });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  } catch (error) { console.error("Failed to generate workflow:", error instanceof Error ? error.message.slice(0, 240) : "unknown"); return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate workflow" }, { status: 500 }); }
}
