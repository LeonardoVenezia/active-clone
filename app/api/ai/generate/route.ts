import { llmRoutes } from "@/lib/free-models";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateAIActionPrompts } from "@/plugins";
import { discoverComposio } from "@/plugins/composio/steps/catalog";

type Operation = {
  op: "setName" | "setDescription" | "addNode" | "addEdge" | "removeNode" | "removeEdge" | "updateNode";
  name?: string; description?: string; node?: unknown; edge?: unknown; nodeId?: string; edgeId?: string;
  updates?: { position?: { x: number; y: number }; data?: unknown };
};
function encodeMessage(encoder: TextEncoder, message: object): Uint8Array { return encoder.encode(`${JSON.stringify(message)}\n`); }
function shouldSkipLine(line: string): boolean { const trimmed = line.trim(); return !trimmed || trimmed.startsWith("```"); }
function tryParseAndEnqueueOperation(line: string, encoder: TextEncoder, controller: ReadableStreamDefaultController, operationCount: number): number {
  const trimmed = line.trim(); if (shouldSkipLine(line)) return operationCount;
  try { const operation = JSON.parse(trimmed) as Operation; const newCount = operationCount + 1; console.log(`[API] Operation ${newCount}:`, operation.op); controller.enqueue(encodeMessage(encoder, { type: "operation", operation })); return newCount; }
  catch { console.warn("[API] Skipping invalid JSON line:", trimmed.substring(0, 50)); return operationCount; }
}
function processBufferLines(buffer: string, encoder: TextEncoder, controller: ReadableStreamDefaultController, operationCount: number): { remainingBuffer: string; newOperationCount: number } {
  const lines = buffer.split("\n"); const remainingBuffer = lines.pop() || ""; let newOperationCount = operationCount;
  for (const line of lines) newOperationCount = tryParseAndEnqueueOperation(line, encoder, controller, newOperationCount);
  return { remainingBuffer, newOperationCount };
}
async function processOperationStream(textStream: AsyncIterable<string>, encoder: TextEncoder, controller: ReadableStreamDefaultController): Promise<void> {
  let buffer = ""; let operationCount = 0; let chunkCount = 0; let charCount = 0;
  for await (const chunk of textStream) { chunkCount += 1; charCount += chunk.length; buffer += chunk; const result = processBufferLines(buffer, encoder, controller, operationCount); buffer = result.remainingBuffer; operationCount = result.newOperationCount; }
  operationCount = tryParseAndEnqueueOperation(buffer, encoder, controller, operationCount);
  console.log("[ai-generate] stream complete", { chunkCount, charCount, operationCount });
  if (operationCount === 0) throw new Error(chunkCount === 0 ? "The free AI model returned nothing (it may be busy). Your prompt was kept. Try again in a moment." : "The AI answered, but not in a form that could change the workflow. Your prompt was kept. Try rephrasing it.");
  controller.enqueue(encodeMessage(encoder, { type: "complete" }));
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

Plugin action types (from integrations):
${pluginActionPrompts}

WIRING DATA BETWEEN STEPS (CRITICAL):
- When a step needs a value produced by an earlier step (an ID, a reference, a status, a name, a total), NEVER invent a value, NEVER use a placeholder, and NEVER leave it for the user to fill. Reference the earlier step's output with a template: {{@node-id:Node Label.field.path}} where node-id is the exact id you gave that node and field.path walks its output fields (standard outputs unwrap automatically, so use the field names from the action's output list, e.g. {{@search-orders:Search Orders.orders}}).
- Arrays: a specific element can be referenced with [index], e.g. {{@search-orders:Search Orders.orders[0].id}}.
- LOOPS (repeat steps per list item): use an action node with {"actionType": "Loop", "source": "{{@node-id:Node Label.arrayField}}", "maxItems": 50, "steps": [...]}. "source" must be a template pointing to an ARRAY field of an earlier step. "steps" is a linear chain of 1-3 inner steps, each {"id": "kebab-id", "actionType": "<any action>", "config": {...}} with the same config shape a normal node uses; they run once per item, in order. Inside inner step configs, reference the current item with {{@item:Item.field.path}} and its position with {{@index:Index.number}}; inner steps can also reference earlier inner steps by their id ({{@check-payment:Check Payment.field}}) and earlier canvas nodes normally. The Loop node's output: results (last inner step's output per completed item), failed (items that failed, with their index and error), count, completed, failedCount. Items that fail are skipped and the run continues. Example per-item payment check: source {{@search-orders:Search Orders.orders}}, one inner step {"id": "check-payment", "actionType": "Search Payments", "config": {"externalReference": "{{@item:Item.id}}"}}. If one AI summary over the whole list serves the request, prefer that simpler whole-list version; use Loop when the user asks to process each item individually.
- Conditions MUST compare template references or fixed values only (e.g. {{@get-order:Get Order.status}} === 'paid'). Invented variables like orderResult.status are invalid.
- When a text or prompt field needs an object or array, reference the whole output or field; it is inserted as JSON.

CRITICAL ABOUT CONDITION NODES:
- Condition nodes evaluate a boolean expression
- When TRUE: ALL connected nodes execute
- When FALSE: ALL connected nodes are SKIPPED
- For if/else logic, CREATE MULTIPLE SEPARATE condition nodes (one per branch)
- NEVER connect multiple different outcome paths to a single condition node
- Each condition should check for ONE specific case

Example: "if good send Slack, if bad create ticket" needs TWO conditions:
{"op": "addNode", "node": {"id": "cond-good", "data": {"config": {"condition": "{{@rate:Rate.value}} === 'good'"}}}}
{"op": "addNode", "node": {"id": "cond-bad", "data": {"config": {"condition": "{{@rate:Rate.value}} === 'bad'"}}}}
{"op": "addEdge", "edge": {"source": "rate", "target": "cond-good"}}
{"op": "addEdge", "edge": {"source": "rate", "target": "cond-bad"}}
{"op": "addEdge", "edge": {"source": "cond-good", "target": "slack"}}
{"op": "addEdge", "edge": {"source": "cond-bad", "target": "ticket"}}

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
          const result = await provider.chat.completions.create({ model: route.model, messages: [{ role: "system", content: getSystemPrompt(composioCatalog) }, { role: "user", content: userPrompt }], stream: true, max_tokens: 4096 });
          for await (const chunk of result) { const value = chunk.choices[0]?.delta?.content; if (value) { got = true; yield value; } }
          if (got) return;
          failures.push(`${route.name}/${route.model}: empty stream`); console.warn("[ai-generate] provider returned no text", route.name, route.model);
        } catch (error) {
          const detail = safeSummary(error); failures.push(`${route.name}/${route.model}: ${detail}`); console.error("[ai-generate] provider stream failed", route.name, route.model, detail);
          if (got) throw error;
        }
      }
      console.error("[ai-generate] all providers exhausted before content", failures);
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ async start(controller) { try { await processOperationStream(textChunks(), encoder, controller); controller.close(); } catch (error) { controller.enqueue(encodeMessage(encoder, { type: "error", error: error instanceof Error ? error.message : "Failed to generate workflow" })); controller.close(); } } });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  } catch (error) { console.error("Failed to generate workflow:", error instanceof Error ? error.message.slice(0, 240) : "unknown"); return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate workflow" }, { status: 500 }); }
}
