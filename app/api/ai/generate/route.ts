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

CRITICAL: Output your workflow as INDIVIDUAL OPERATIONS, one per line in JSONL format. Each line must be a complete, separate JSON object.
Operations: setName, setDescription, addNode, addEdge, removeNode, removeEdge, updateNode. Start with setName and setDescription, add nodes, then add edges so every node is reachable from exactly one trigger. Output only valid JSON operations, one per line; no markdown or explanatory prose.
Node structure: {"id":"unique-id","type":"trigger"|"action","position":{"x":number,"y":number},"data":{"label":"Node Label","description":"Node description","type":"trigger"|"action","config":{},"status":"idle"}}. Use built-in action types when appropriate. Plugin actions (from integrations):
${pluginActionPrompts}
If the request needs a Composio action, use only a listed exact toolkit/slug pair and its schema. Do not invent actions or args. For conditions, use separate Condition nodes for distinct branches. Connect all nodes. Put new nodes about 250px apart, avoid overlaps, and preserve existing nodes when modifying a workflow.`;
}
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || session.user.isAnonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json(); const { prompt, existingWorkflow } = body;
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    if (!llmRoutes().length) return NextResponse.json({ error: "AI API key not configured on server." }, { status: 500 });
    let composioCatalog = "";
    const requestedToolkits = ["outlook", "gmail", "slack", "notion", "airtable", "google_sheets", "google_drive", "github", "linear", "stripe", "hubspot", "jira", "hackernews"];
    if (/\b(composio|outlook|gmail|email|mail|slack|notion|airtable|sheets|drive|github|linear|stripe|hubspot|jira|hacker\s*news)\b/i.test(String(prompt))) {
      const results = await Promise.all(requestedToolkits.map(async toolkit => { try { return { toolkit, result: await discoverComposio({ catalog: "tools", toolkit }) }; } catch (error) { console.error("[ai-generate] Composio catalog lookup failed", toolkit, error instanceof Error ? error.message : "unknown"); return null; } }));
      const actions = results.flatMap(entry => entry?.result?.items?.map((tool: Record<string, unknown>) => ({ toolkit: entry.toolkit, slug: tool.slug, name: tool.name, description: tool.description, input_parameters: tool.input_parameters })) ?? []);
      composioCatalog = actions.length ? `LIVE COMPOSIO ACTION CATALOG (exact names and schemas):\n${JSON.stringify(actions)}` : "No live Composio action catalog was available. Do not invent Composio actions.";
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
