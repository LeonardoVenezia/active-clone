import { NextResponse } from "next/server";
import { workflowAccessFacts } from "@/lib/datos/access";
import { authorizeFrontendRun } from "@/lib/datos/frontend";
import { POST as executeWorkflowRoute } from "../../../workflow/[workflowId]/execute/route";

// Run a workflow from its Frontend page. Dedicated route: it applies the full
// Frontend authorization on the server (session, owner/share, org scope AND
// org membership, Frontend node with the button on, same origin) and only then
// delegates to the normal execute route with a FIXED empty input. The request
// body is ignored. The normal builder route keeps its own, unchanged scope.
export async function POST(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    const { facts, nodes } = await workflowAccessFacts(request, workflowId);
    const decision = authorizeFrontendRun({ facts, nodes, requestOrigin: request.headers.get("origin"), urlOrigin: new URL(request.url).origin });
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: decision.status });
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.delete("content-length");
    const forwarded = new Request(new URL(`/api/workflow/${encodeURIComponent(workflowId)}/execute`, request.url), { method: "POST", headers, body: JSON.stringify({ input: {} }) });
    return await executeWorkflowRoute(forwarded, { params: Promise.resolve({ workflowId }) });
  } catch {
    return NextResponse.json({ error: "No se pudo iniciar." }, { status: 503 });
  }
}
