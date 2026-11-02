import { NextResponse } from "next/server";
import { workflowAccessFacts } from "@/lib/datos/access";
import { datosEnabled, datosGetFields, datosSave } from "@/lib/datos/core";
import { validateAgainstFields } from "@/lib/datos/fields";
import { authorizeFrontendSubmit, frontendViewFromNodes } from "@/lib/datos/frontend";
import { pgDatosRepo } from "@/lib/datos/repo";
import { POST as executeWorkflowRoute } from "../../../workflow/[workflowId]/execute/route";

// Send the form of a Frontend page. Server-side only decisions: session,
// owner/share, org scope AND membership, same origin, form switched on in the
// Frontend node. The organization and collection come from the server copy of
// the workflow; the body only supplies the field values, which are checked
// against the collection's defined fields (unknown fields are rejected).
// If the node asks for it, the workflow then runs with the validated values
// as its trigger input (the Manual trigger's own inputFields rules still apply).
export async function POST(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  try {
    if (!datosEnabled()) return NextResponse.json({ error: "Los datos todavía no están habilitados." }, { status: 404 });
    const { workflowId } = await context.params;
    const { facts, nodes } = await workflowAccessFacts(request, workflowId);
    const decision = authorizeFrontendSubmit({ facts, nodes, requestOrigin: request.headers.get("origin"), urlOrigin: new URL(request.url).origin });
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: decision.status });
    const view = frontendViewFromNodes(nodes);
    if (!view) return NextResponse.json({ error: "Esta página no tiene formulario." }, { status: 404 });
    const raw = await request.text();
    if (raw.length > 20_000) return NextResponse.json({ error: "El formulario es demasiado grande." }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Formulario inválido." }, { status: 400 }); }
    const values = (body as { values?: unknown } | null)?.values;
    const fields = await datosGetFields(pgDatosRepo, decision.organizationId, view.collection);
    if (!fields) return NextResponse.json({ error: "La colección todavía no tiene campos definidos. Definilos con un nodo Datos (Definir campos)." }, { status: 400 });
    const checked = validateAgainstFields(fields, values);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const keyValue = view.keyField ? checked.value[view.keyField] : undefined;
    if (view.keyField && (keyValue === undefined || keyValue === "")) return NextResponse.json({ error: `Falta el campo "${view.keyField}", que se usa como clave.` }, { status: 400 });
    const key = view.keyField ? String(keyValue) : `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const saved = await datosSave(pgDatosRepo, decision.organizationId, { collection: view.collection, key, value: checked.value });
    if (!saved.success) return NextResponse.json({ error: saved.error }, { status: 400 });
    if (!view.runOnSubmit) return NextResponse.json({ saved: true, key });
    // Flat text values, as the Manual trigger expects; if it declares inputFields it keeps only those keys.
    const runInput: Record<string, string> = {};
    for (const [k, v] of Object.entries(checked.value)) runInput[k] = String(v);
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.delete("content-length");
    const forwarded = new Request(new URL(`/api/workflow/${encodeURIComponent(workflowId)}/execute`, request.url), { method: "POST", headers, body: JSON.stringify({ input: runInput }) });
    const run = await executeWorkflowRoute(forwarded, { params: Promise.resolve({ workflowId }) });
    if (!run.ok) return NextResponse.json({ saved: true, key, started: false, error: "Se guardó, pero no se pudo iniciar el workflow." }, { status: 502 });
    return NextResponse.json({ saved: true, key, started: true });
  } catch {
    return NextResponse.json({ error: "No se pudo enviar." }, { status: 503 });
  }
}
