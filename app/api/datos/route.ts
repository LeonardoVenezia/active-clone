import { NextResponse } from "next/server";
import { orgForWorkflowRead } from "@/lib/datos/access";
import { datosEnabled, datosList } from "@/lib/datos/core";
import { frontendViewFromNodes } from "@/lib/datos/frontend";
import { pgDatosRepo } from "@/lib/datos/repo";

// Read-only data for the Frontend page of ONE workflow. Query: workflowId only.
// Organization and collection both come from the server copy of the workflow
// (scope + Frontend node config); nothing else in the request can choose them.
export async function GET(request: Request) {
  if (!datosEnabled()) return NextResponse.json({ enabled: false, records: [] });
  try {
    const workflowId = new URL(request.url).searchParams.get("workflowId") || "";
    const ctx = workflowId ? await orgForWorkflowRead(request, workflowId) : null;
    if (!ctx) return NextResponse.json({ error: "Sin acceso a los datos de esta empresa." }, { status: 403 });
    const view = frontendViewFromNodes(ctx.nodes);
    if (!view) return NextResponse.json({ error: "Este workflow no tiene un nodo Frontend válido. Revisá que exista y que la colección use solo minúsculas, números y guion bajo (_)." }, { status: 404 });
    const result = await datosList(pgDatosRepo, ctx.organizationId, { collection: view.collection, limit: 50 });
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ enabled: true, view, canRun: true, records: result.records }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos cargar los datos." }, { status: 503 });
  }
}
