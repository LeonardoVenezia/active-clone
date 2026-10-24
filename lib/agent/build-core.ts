import { generateAIActionPrompts } from "@/plugins";
import { generateAITriggerPrompts, getAllActions, getAllIntegrations, getAllTriggers } from "@/plugins/registry";
import { tool } from "ai";
import { z } from "zod";
import { getActionOutputFields, getActionOutputItemFields } from "@/plugins/registry";
import { type FlowEdge, type FlowNode, type SheetColumnsContract, channelConsistencyError, conditionExpressionError, cyclicFlowError, formulaExpressionError, httpSchemaError, listCrossingError, perItemLoopError, planCoverageError, questionActionError, requestCoverageError, sheetContractError, shipmentDetailError, unwiredReportStepError, userIntentText, validateFlow } from "@/lib/flow-validator";

// Builder core shared by the /api/ai/generate route and the unified chat agent: operations, the validated in-memory graph, the builder rules prompt and valid type sets.
export type Operation = {
  op: "setName" | "setDescription" | "addNode" | "addEdge" | "removeNode" | "removeEdge" | "updateNode";
  name?: string; description?: string; node?: unknown; edge?: unknown; nodeId?: string; edgeId?: string;
  updates?: { position?: { x: number; y: number }; data?: unknown };
};

export type Shadow = { nodes: FlowNode[]; edges: FlowEdge[] };
export function shadowApply(operation: Operation, shadow: Shadow): boolean {
  if (operation.op === "addNode") {
    const node = operation.node as FlowNode | undefined;
    if (!node?.id || !node.data) return false;
    if (shadow.nodes.some((n) => n.id === node.id)) return false;
    // Deterministic fix for a recurring model mistake: Loop inner steps must
    // carry ALL parameters inside "config". Fold stray top-level keys in.
    const cfg = node.data.config as Record<string, unknown> | undefined;
    if (cfg?.actionType === "Loop" && Array.isArray(cfg.steps)) {
      for (const step of cfg.steps as Array<Record<string, unknown>>) {
        if (!step || typeof step !== "object") continue;
        const inner = (step.config && typeof step.config === "object" ? { ...(step.config as Record<string, unknown>) } : {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(step)) {
          if (k !== "id" && k !== "actionType" && k !== "steps" && k !== "config") inner[k] = v;
        }
        step.config = inner;
      }
    }
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
    const upd = operation.updates?.data as FlowNode["data"] | undefined;
    shadow.nodes = shadow.nodes.map((n) => {
      if (n.id !== operation.nodeId) return n;
      const mergedData = upd
        ? { ...n.data, ...upd, config: { ...((n.data?.config ?? {}) as object), ...((upd.config ?? {}) as object) } }
        : n.data;
      return { ...n, ...(operation.updates?.position ? { position: operation.updates.position } : {}), ...(upd ? { data: mergedData } : {}) } as FlowNode;
    });
    return true;
  }
  return operation.op === "setName" || operation.op === "setDescription";
}
const OPS_FORMAT = `CRITICAL: Output your workflow as INDIVIDUAL OPERATIONS, one per line in JSONL format.
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
- Apps with a NATIVE plugin (whatsapp, slack, tiendanube, mercadolibre, zipnova, stripe, github, linear, mercadopago) MUST use the plugin's own action (e.g. whatsapp/send-message, slack/send-message, mercadolibre/get-order): never the generic "Send Message"/"Send Email" actions, never a hand-rolled HTTP Request, and never the Composio toolkit for those apps
- Apps covered by the Composio catalog (gmail, googlesheets, googledocs, googledrive, notion, airtable, hubspot, jira, outlook) MUST go through composio/run-tool with that toolkit: never a hand-rolled HTTP Request to their API (no raw https://sheets.googleapis.com, gmail, or similar URLs)
- Output ONE operation per line
- Each line must be complete, valid JSON
- Start with setName and setDescription
- Then add nodes one at a time
- Finally add edges one at a time to CONNECT ALL NODES
- CRITICAL: Every node (except the last) MUST be connected to at least one other node
- To update node positions or properties, use updateNode operation
- NEVER output explanatory text - ONLY JSON operations
- Do NOT wrap in markdown code blocks
- Do NOT add explanatory text`;

const OPS_EXAMPLES = `Example output (linear workflow with 250px horizontal spacing):
{"op": "setName", "name": "Contact Form Workflow"}
{"op": "setDescription", "description": "Processes contact form submissions"}
{"op": "addNode", "node": {"id": "trigger-1", "type": "trigger", "position": {"x": 100, "y": 200}, "data": {"label": "Contact Form", "type": "trigger", "config": {"triggerType": "Manual"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "draft-message", "type": "action", "position": {"x": 350, "y": 200}, "data": {"label": "Draft Message", "type": "action", "config": {"actionType": "ai-gateway/generate-text", "prompt": "Write a short welcome message for the new contact form submission"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "notify-channel", "type": "action", "position": {"x": 600, "y": 200}, "data": {"label": "Notify Channel", "type": "action", "config": {"actionType": "slack/send-message", "channel": "#general", "text": "{{@draft-message:Draft Message.text}}"}, "status": "idle"}}}
{"op": "addEdge", "edge": {"id": "e1", "source": "trigger-1", "target": "draft-message", "type": "default"}}
{"op": "addEdge", "edge": {"id": "e2", "source": "draft-message", "target": "notify-channel", "type": "default"}}

Example output (branching workflow with 250px vertical spacing):
{"op": "addNode", "node": {"id": "trigger-1", "type": "trigger", "position": {"x": 100, "y": 200}, "data": {"label": "Webhook", "type": "trigger", "config": {"triggerType": "Webhook", "webhookPath": "/webhooks/new-order"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "branch-a", "type": "action", "position": {"x": 350, "y": 75}, "data": {"label": "Branch A", "type": "action", "config": {"actionType": "slack/send-message", "channel": "#general", "text": "New order received"}, "status": "idle"}}}
{"op": "addNode", "node": {"id": "branch-b", "type": "action", "position": {"x": 350, "y": 325}, "data": {"label": "Branch B", "type": "action", "config": {"actionType": "tiendanube/search-orders"}, "status": "idle"}}}
{"op": "addEdge", "edge": {"id": "e1", "source": "trigger-1", "target": "branch-a", "type": "default"}}
{"op": "addEdge", "edge": {"id": "e2", "source": "trigger-1", "target": "branch-b", "type": "default"}}`;

const TOOL_FORMAT = `CRITICAL: Build the workflow by CALLING THE PROVIDED TOOLS - never by writing JSON, JSONL, markdown fences or explanatory text as your reply.

Tools you can call:
- set_name(name, description?) - call once, first.
- add_node(id, nodeType, label, actionType, config?) - add ONE node. nodeType is "trigger" or "action". actionType is the trigger/action type (e.g. "Schedule", "slack/send-message", "Condition", "Loop", "Fórmula"); config carries the node settings, the same "config" object shape described below (a trigger's config carries triggerType instead of actionType).
- connect(source, target) - wire one node's output into another node's input; both ids must already exist.
- update_parameters(nodeId, config) - merge new settings into an existing node (fix or complete its config).
- remove_node(nodeId) - remove a wrong node and its wires.

IMPORTANT RULES:
- Every workflow must have EXACTLY ONE trigger node
- Apps with a NATIVE plugin (whatsapp, slack, tiendanube, mercadolibre, zipnova, stripe, github, linear, mercadopago) MUST use the plugin's own action (e.g. whatsapp/send-message, slack/send-message, mercadolibre/get-order): never the generic "Send Message"/"Send Email" actions, never a hand-rolled HTTP Request, and never the Composio toolkit for those apps
- Apps covered by the Composio catalog (gmail, googlesheets, googledocs, googledrive, notion, airtable, hubspot, jira, outlook) MUST go through composio/run-tool with that toolkit: never a hand-rolled HTTP Request to their API (no raw https://sheets.googleapis.com, gmail, or similar URLs)
- Call set_name first, then add nodes one at a time, then connect them
- CRITICAL: Every node (except the last) MUST be connected to at least one other node
- Each tool call is validated immediately: if a call returns an error, fix exactly THAT call and retry it - do NOT rebuild everything from scratch
- If a value the flow needs is missing and no earlier step can produce it (a destination, an account, an id, the exact message text), call ask_user BEFORE adding nodes; never invent those values - EXCEPT when the user explicitly asked for a draft or mock (maqueta, ejemplo, prueba): then use clearly-marked placeholder values and name each assumption in your closing message instead of asking
- Always close with a short conversational message in Spanish: what you built, anything you assumed, and any open question. Never stay silent and never say you could not - if something is missing, say what and ask`;

const TOOL_EXAMPLES = `Example build sequence (linear workflow): set_name("Contact Form Workflow") -> add_node({"id":"trigger-1","nodeType":"trigger","label":"Contact Form","actionType":"Manual"}) -> add_node({"id":"draft-message","nodeType":"action","label":"Draft Message","actionType":"ai-gateway/generate-text","config":{"prompt":"Write a short welcome message for the new contact form submission"}}) -> add_node({"id":"notify-channel","nodeType":"action","label":"Notify Channel","actionType":"slack/send-message","config":{"channel":"#general","text":"{{@draft-message:Draft Message.text}}"}}) -> connect("trigger-1","draft-message") -> connect("draft-message","notify-channel")`;

const OPS_OUTRO = `REMEMBER: After adding all nodes, you MUST add edges to connect them! Every node should be reachable from the trigger.`;

const TOOL_OUTRO = `REMEMBER: after adding all nodes you MUST call connect for every wire! Every node should be reachable from the trigger. When the graph is complete and every node is wired, stop calling tools.`;

export function getSystemPrompt(composioCatalog = "", mode: "ops" | "tools" = "ops"): string {
  const pluginActionPrompts = generateAIActionPrompts();
  const pluginTriggerPrompts = generateAITriggerPrompts();
  return `You are a workflow automation expert. Generate a workflow based on the user's description.

${mode === "tools" ? TOOL_FORMAT : OPS_FORMAT}

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

SCOPE RULE: build ONLY the steps and apps the user asked for. Never add extra steps with apps the user did not mention - no extra notifications (Slack/WhatsApp/email), no extra platforms, no extra tickets - even if they seem useful.

NODE POSITIONING RULES:
- Nodes are squares, so use equal spacing in both directions
- Horizontal spacing between sequential nodes: 250px (e.g., x: 100, then x: 350, then x: 600)
- Vertical spacing for parallel branches: 250px (e.g., y: 75, y: 325, y: 575)
- Start trigger node at position {"x": 100, "y": 200}
- For linear workflows: increment x by 250 for each subsequent node, keep y constant
- For branching workflows: keep x the same for parallel branches, space y by 250px per branch
- When adding nodes to existing workflows, position new nodes 250px away from existing nodes

Trigger types:
- Choose the trigger from the user's words: anything repeating ("todos los días", "cada mañana", "every day", "a las 8", "diario", "semanal", "cada hora") is ALWAYS Schedule with the right scheduleCron, NEVER Manual. Manual only when the user asks to run it by hand.
- Manual: {"triggerType": "Manual"}
- Webhook: {"triggerType": "Webhook", "webhookPath": "/webhooks/name", ...}
- Schedule: {"triggerType": "Schedule", "scheduleCron": "0 9 * * *", ...}
${pluginTriggerPrompts ? `Plugin event triggers (use these triggerType values when the flow starts from an app event; wire later steps with the listed outputs):
${pluginTriggerPrompts}` : ""}

System action types (built-in):
- Database Query: {"actionType": "Database Query", "dbQuery": "SELECT * FROM table", "dbTable": "table"}
- HTTP Request: {"actionType": "HTTP Request", "httpMethod": "POST", "endpoint": "https://api.example.com", "httpHeaders": "{}", "httpBody": "{}"} — when the user pasted a sample response of that API, copy it verbatim into config.responseSchema (a JSON string) so references into its .data output can be verified.
- Condition: {"actionType": "Condition", "condition": "{{@nodeId:Label.field}} === 'value'"}
- Delay: {"actionType": "Delay", "durationMinutes": 10} — pauses the workflow durably before continuing (use "durationSeconds" for sub-minute waits). NEVER simulate a wait with an HTTP Request to an external service.
- Approval: {"actionType": "Approval", "message": "..."} — pauses the run until a person approves or rejects it from the runs view (human-in-the-loop). Use it whenever the user should review, choose or authorize something before the flow continues (e.g. picking one of N generated options, authorizing a publication or a purchase). A rejection ends the run. Later steps can reference {{@node-id:Label.approved}} and {{@node-id:Label.note}}. When the user asks to be presented options to review or choose from, use this node for that step (never a messaging app they did not ask for).
- Fórmula: {"actionType": "Fórmula", "input": "{\"precio\": 100}", "expression": "precio * 1.21"} — evaluates a JSONata expression over the JSON input; use it to transform, calculate, filter or reshape data between steps. "input" is a JSON string that may contain {{@...}} templates; "expression" is plain JSONata (no {{@...}} templates inside).

Plugin action types (from integrations):
${pluginActionPrompts}

WIRING DATA BETWEEN STEPS (CRITICAL):
- When a step needs a value produced by an earlier step (an ID, a reference, a status, a name, a total), NEVER invent a value, NEVER use a placeholder, and NEVER leave it for the user to fill. Reference the earlier step's output with a template: {{@node-id:Node Label.field.path}} where node-id is the exact id you gave that node and field.path walks its output fields (standard outputs unwrap automatically, so use the field names from the action's output list, e.g. {{@search-orders:Search Orders.orders}}).
- Arrays: a specific element can be referenced with [index], e.g. {{@search-orders:Search Orders.orders[0].id}}.
- LOOPS (repeat steps per list item): use an action node with {"actionType": "Loop", "source": "{{@node-id:Node Label.arrayField}}", "maxItems": 50, "steps": [...]}. "source" must be a template pointing to an ARRAY field of an earlier step. "steps" is a linear chain of 1-3 inner steps, each {"id": "kebab-id", "actionType": "<any action>", "config": {...}} with the same config shape a normal node uses - ALL parameters of an inner step MUST go inside its "config" object, never at the step's top level; they run once per item, in order. Inside inner step configs, reference the current item with {{@item:Item.field.path}} and its position with {{@index:Index.number}}; inner steps can also reference earlier inner steps by their id ({{@check-payment:Check Payment.field}}) and earlier canvas nodes normally. The Loop node's output: results (last inner step's output per completed item), items (one entry per completed item: {"index", "item", "steps": {"<inner-step-id with non-alphanumerics as _>": that step's output}} - use {{@loop-id:Label.items}} when a later step needs data from EVERY inner step per item, e.g. both the order detail and its payment), failed (items that failed, with their index and error), count, completed, failedCount. Items that fail are skipped and the run continues. A Condition as an inner step FILTERS the item: when it is false, the remaining inner steps are skipped for that item and the item is excluded from results (counted in filteredCount), without failing the run. Example per-item payment check: source {{@search-orders:Search Orders.orders}}, one inner step {"id": "check-payment", "actionType": "Search Payments", "config": {"externalReference": "{{@item:Item.id}}"}}. If one AI summary over the whole list serves the request, prefer that simpler whole-list version; use Loop when the user asks to process each item individually. COMPARING TWO LISTS (reconciliation, joins, finding items present in one list and missing in the other, e.g. payments vs orders) MUST use ONE Fórmula node built from this EXACT prebuilt template - never free-form JSONata, never a Loop that only echoes items, NEVER an AI text step. In the Fórmula's "input" JSON string bind the ARRAY output of each list (e.g. {"pagos": {{@stripe-step:Stripe.payments}}, "ordenes": {{@orders-step:Orders.orders}}} - never .count/.hasMore or an indexed element like [0]). For "expression" copy ONE of these two templates; you choose ONLY the input key names, the join field of each list, and you may rename soloEnA/soloEnB to meaningful names (e.g. cobrosSinOrden/ordenesSinCobro) - everything else verbatim: NUMERIC JOIN (amounts, totals, quantities; $number normalizes "15000.00" strings): {"soloEnA": $filter(keyA, function($x) { $not($number($x.fieldA) in $map(keyB, function($y){ $number($y.fieldB) })) }), "soloEnB": $filter(keyB, function($y) { $not($number($y.fieldB) in $map(keyA, function($x){ $number($x.fieldA) })) })}. STRING JOIN (ids, emails, SKUs): {"soloEnA": $filter(keyA, function($x) { $not($x.fieldA in keyB.fieldB) }), "soloEnB": $filter(keyB, function($y) { $not($y.fieldB in keyA.fieldA) })}. Do NOT simplify the template to a projection (keyA alone), a subtraction of counts, a constant string, or per-item echoes. AI text steps only write prose about an already-computed result; they must never compute list logic, filtering or matching.
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
{"op": "addNode", "node": {"id": "cond-good", "type": "action", "data": {"label": "Is Good", "type": "action", "config": {"actionType": "Condition", "condition": "{{@rate:Rate.value}} === 'good'"}}}}
{"op": "addNode", "node": {"id": "cond-bad", "type": "action", "data": {"label": "Is Bad", "type": "action", "config": {"actionType": "Condition", "condition": "{{@rate:Rate.value}} === 'bad'"}}}}
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

${mode === "ops" ? OPS_EXAMPLES : TOOL_EXAMPLES}

${composioCatalog ? `\n${composioCatalog}\n` : ""}
${mode === "tools" ? TOOL_OUTRO : OPS_OUTRO}`;
}


const SYSTEM_ACTION_TYPES = ["Database Query", "HTTP Request", "Condition", "Delay", "Fórmula", "Loop", "Approval"];
let cachedValidTriggerTypes: Set<string> | null = null;
export function getValidTriggerTypes(): Set<string> {
  if (!cachedValidTriggerTypes) {
    cachedValidTriggerTypes = new Set(["Manual", "Webhook", "Schedule"]);
    for (const t of getAllTriggers()) cachedValidTriggerTypes.add(t.id);
  }
  return cachedValidTriggerTypes;
}
let cachedValidActionTypes: Set<string> | null = null;
export function getValidActionTypes(): Set<string> {
  if (!cachedValidActionTypes) {
    cachedValidActionTypes = new Set(SYSTEM_ACTION_TYPES);
    for (const a of getAllActions()) { cachedValidActionTypes.add(a.id); if (a.label) cachedValidActionTypes.add(a.label); }
  }
  return cachedValidActionTypes;
}




// Deliverable check driven by the registry: when the request asks to create/generate videos, images or audio and the product has
// actions whose output is that media, the canvas must contain one. Prevents silently swapping the deliverable for a script/text.
const MEDIA: [RegExp, string, string][] = [[/\b(?:cre\w*|gener\w*|arm\w*|produc\w*|hac\w*|make|creat\w*|build)\s+(?:\w+\s+){0,4}?videos?\b/i, "video", "video"], [/\b(?:cre\w*|gener\w*|produc\w*|make|creat\w*)\s+(?:\w+\s+){0,3}?(?:im[aá]genes|imagen|images?)\b/i, "image", "image"], [/\b(?:cre\w*|gener\w*|produc\w*|make|creat\w*)\s+(?:\w+\s+){0,3}?(?:audios?|voz|voice)\b/i, "audio", "audio"]];
/** Every action type on the canvas, including steps nested inside Loops (they run too). */
export function allActionTypes(nodes: FlowNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (cfg: { actionType?: unknown; steps?: unknown } | undefined) => { if (!cfg) return; if (typeof cfg.actionType === "string") out.add(cfg.actionType); if (Array.isArray(cfg.steps)) for (const st of cfg.steps as Array<{ actionType?: unknown; config?: { steps?: unknown } }>) walk({ actionType: st?.actionType, steps: st?.config?.steps ?? (st as { steps?: unknown })?.steps }); };
  for (const n of nodes) walk((n.data as { config?: { actionType?: string; steps?: unknown } } | undefined)?.config);
  return out;
}
export function deliverableCoverageError(requestText: string, nodes: FlowNode[], skip?: Set<string>): string | null {
  const types = new Map<string, Set<string>>();
  for (const p of getAllIntegrations()) for (const a of p.actions) { const t = (a as { outputConfig?: { type?: string } }).outputConfig?.type; if (t) { if (!types.has(t)) types.set(t, new Set()); types.get(t)?.add(`${p.type}/${a.slug}`); } }
  const missing: string[] = [];
  for (const [re, kind, label] of MEDIA) {
    if (!re.test(requestText) || skip?.has(kind)) continue;
    const ids = types.get(kind); if (!ids?.size) continue;
    const present = allActionTypes(nodes); const has = [...ids].some(x => present.has(x));
    if (!has) missing.push(`${label} (use one of: ${[...ids].join(", ")})`);
  }
  return missing.length ? `consistencia: the request asks to create ${missing.join("; ")} but the canvas has no step that produces it; add that step (one per item when several are requested, inside the Loop) instead of stopping at text/scripts. Never drop a requested deliverable on your own: if it truly cannot be built, say so to the user` : null;
}

export function computeFlowErrors(shadow: Shadow, ctx: { composioCatalogMap: Map<string, string[]>; sheetContracts: SheetColumnsContract[]; userPrompt: string; userRequest?: string; skipDeliverables?: Set<string> }): string[] {
  const { composioCatalogMap, sheetContracts, userPrompt } = ctx;
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
      const deliverable = deliverableCoverageError(ctx.userRequest ?? userIntentText(userPrompt), shadow.nodes, ctx.skipDeliverables);
  if (deliverable) errs.push(deliverable);
  const cyclic = cyclicFlowError(shadow.nodes, shadow.edges);
      if (cyclic) errs.push(cyclic);
      const sheetContract = sheetContractError(shadow.nodes, sheetContracts);
      if (sheetContract) errs.push(sheetContract);
      const httpSchema = httpSchemaError(shadow.nodes);
      if (httpSchema) errs.push(httpSchema);
      const unwired = unwiredReportStepError(shadow.nodes, shadow.edges);
      if (unwired) errs.push(unwired);
      return errs;
    }

export function createBuildTools(shadow: Shadow, hooks: { onName?: (n: string) => void; onAsk?: (q: string) => void; onOp?: (op: Operation) => void; noAsk?: boolean } = {}) {
  const apply = (op: Operation, sh: Shadow) => { const ok = shadowApply(op, sh); if (ok) hooks.onOp?.(op); return ok; };
  const tools = {
        set_name: tool({
          description: "Set the workflow name and optional description. Call once, first.",
          inputSchema: z.object({ name: z.string(), description: z.string().optional() }),
          execute: async ({ name, description }) => { hooks.onName?.(name); apply({ op: "setName", name }, shadow); if (description) apply({ op: "setDescription", description }, shadow); return { ok: true }; },
        }),
        ask_user: tool({
          description: "Ask the user for missing information BEFORE building. Use when a value the flow needs is not provided and no earlier step can produce it. Do not build until they answer. Do NOT use when the user asked for a draft/mock (maqueta, ejemplo, prueba): use placeholders then.",
          inputSchema: z.object({ question: z.string().describe("the concrete question for the user, in Spanish, conversational") }),
          execute: async ({ question }) => { hooks.onAsk?.(question); return { ok: true }; },
        }),
        add_node: tool({
          description: "Add ONE node to the workflow. nodeType 'trigger' or 'action'; actionType is the trigger/action type; config carries the node settings.",
          inputSchema: z.object({ id: z.string().describe("unique kebab-case id"), nodeType: z.enum(["trigger", "action"]), label: z.string(), actionType: z.string(), config: z.record(z.string(), z.unknown()).optional() }),
          execute: async ({ id, nodeType, label, actionType, config }) => {
            const valid = nodeType === "trigger" ? getValidTriggerTypes() : getValidActionTypes();
            const match = [...valid].find(v => v === actionType || v.toLowerCase() === actionType.toLowerCase());
            if (!match) return { ok: false, error: `unknown ${nodeType} type "${actionType}". Valid types include: ${[...valid].slice(0, 50).join(", ")}` };
            const cfg = { ...(config ?? {}), ...(nodeType === "trigger" ? { triggerType: match } : { actionType: match }) };
            const ok = apply({ op: "addNode", node: { id, type: nodeType, position: { x: 120 + shadow.nodes.length * 260, y: 120 }, data: { label, type: nodeType, config: cfg, status: "idle" } } }, shadow);
            return ok ? { ok: true } : { ok: false, error: `node id "${id}" already exists or is invalid - pick a new unique id` };
          },
        }),
        connect: tool({
          description: "Wire one node's output into another node's input. Both ids must already exist.",
          inputSchema: z.object({ source: z.string(), target: z.string() }),
          execute: async ({ source, target }) => {
            const ok = apply({ op: "addEdge", edge: { source, target } }, shadow);
            return ok ? { ok: true } : { ok: false, error: `cannot connect ${source} -> ${target}: both nodes must already exist and the edge must not duplicate an existing one` };
          },
        }),
        update_parameters: tool({
          description: "Merge new config values into an existing node (fix or complete its settings).",
          inputSchema: z.object({ nodeId: z.string(), config: z.record(z.string(), z.unknown()) }),
          execute: async ({ nodeId, config }) => {
            const ok = apply({ op: "updateNode", nodeId, updates: { data: { config } } }, shadow);
            return ok ? { ok: true } : { ok: false, error: `node "${nodeId}" does not exist` };
          },
        }),
        remove_node: tool({
          description: "Remove a wrong node and its wires.",
          inputSchema: z.object({ nodeId: z.string() }),
          execute: async ({ nodeId }) => { apply({ op: "removeNode", nodeId }, shadow); return { ok: true }; },
        }),
      };
  if (hooks.noAsk) delete (tools as Partial<typeof tools>).ask_user;
  return tools as Omit<typeof tools, "ask_user"> & Partial<Pick<typeof tools, "ask_user">>;
}

// Deterministic repair: references into a Formula node need the "result." wrapper the engine adds.
export function fixFormulaRefsIn(shadow: Shadow): number {
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
      }

/** Deterministic facts about how data flows, for the agent to reconcile with what was agreed. Facts only: no verdicts, no per-example rules. */
export function lineageFacts(shadow: Shadow): string[] {
  const refs = new Map<string, Set<string>>();
  for (const n of shadow.nodes) {
    const txt = JSON.stringify((n.data as { config?: unknown })?.config ?? {});
    for (const m of txt.matchAll(/\{\{@([^:}]+):/g)) { const set = refs.get(m[1]) ?? new Set<string>(); set.add(n.id); refs.set(m[1], set); }
  }
  const label = (id: string) => String((shadow.nodes.find(n => n.id === id)?.data as { label?: string })?.label ?? id);
  const out: string[] = [];
  const hasOut = new Set(shadow.edges.map(e => e.source));
  const unused = shadow.nodes.filter(n => (n.data as { type?: string })?.type === "action" && hasOut.has(n.id) && !refs.has(n.id)).map(n => label(n.id));
  if (unused.length) out.push(`Steps whose output no later step reads: ${unused.join(", ")}.`);
  const loops = shadow.nodes.filter(n => (n.data as { config?: { actionType?: string } })?.config?.actionType === "Loop").map(n => label(n.id));
  out.push(loops.length ? `Steps repeated per list item (Loop): ${shadow.nodes.filter(n => (n.data as { config?: { actionType?: string } })?.config?.actionType === "Loop").map(n => { const st = ((n.data as { config?: { steps?: Array<{ actionType?: string }> } })?.config?.steps ?? []).map(x => String(x?.actionType ?? "?")).join(" -> "); return `${label(n.id)} [${st || "no inner steps"}] (one run of the inner steps per item, so each inner action produces ONE output per item)`; }).join("; ")}.` : "No Loop step: every step runs exactly once per run (one output each).");
  return out;
}

/** Candidate deliverables (media kinds) the user's text asks to create that the canvas does not produce. A detector only: it never decides intent. */
export function missingMediaKinds(requestText: string, nodes: FlowNode[]): string[] {
  const types = new Map<string, Set<string>>();
  for (const p of getAllIntegrations()) for (const a of p.actions) { const t = (a as { outputConfig?: { type?: string } }).outputConfig?.type; if (t) { if (!types.has(t)) types.set(t, new Set()); types.get(t)?.add(`${p.type}/${a.slug}`); } }
  const out: string[] = [];
  for (const [re, kind] of MEDIA) {
    if (!re.test(requestText)) continue;
    const ids = types.get(kind); if (!ids?.size) continue;
    { const present = allActionTypes(nodes); if (![...ids].some(x => present.has(x))) out.push(kind); }
  }
  return out;
}
