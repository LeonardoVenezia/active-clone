import { NextResponse } from "next/server";
import { workflowAccessFacts } from "@/lib/datos/access";
import { datosEnabled, datosSave } from "@/lib/datos/core";
import {
  authorizeFrontendAction,
  frontendViewFromNodes,
} from "@/lib/datos/frontend";
import { pgDatosRepo } from "@/lib/datos/repo";

// Run a declared row ACTION of a Frontend page. Server-side only decisions:
// session, owner/share, org scope AND membership, same origin, and the action
// declared in the Frontend node config. The organization, collection, action
// list and target field come from the SERVER copy of the workflow; the body
// only says which declared action and which record key. The action writes
// actionField=<actionId> on that record, merging with its current value:
// nothing else of the record changes, and no workflow runs.
export async function POST(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    if (!datosEnabled()) {
      return NextResponse.json(
        { error: "Los datos todavía no están habilitados." },
        { status: 404 }
      );
    }
    const { workflowId } = await context.params;
    const { facts, nodes } = await workflowAccessFacts(request, workflowId);
    const decision = authorizeFrontendAction({
      facts,
      nodes,
      requestOrigin: request.headers.get("origin"),
      urlOrigin: new URL(request.url).origin,
    });
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.reason },
        { status: decision.status }
      );
    }
    const view = frontendViewFromNodes(nodes);
    if (!view) {
      return NextResponse.json(
        { error: "Esta página no tiene acciones." },
        { status: 404 }
      );
    }
    const raw = await request.text();
    if (raw.length > 2000) {
      return NextResponse.json(
        { error: "Pedido demasiado grande." },
        { status: 413 }
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    }
    const actionId = (body as { action?: unknown } | null)?.action;
    const key = (body as { key?: unknown } | null)?.key;
    const declared =
      typeof actionId === "string"
        ? view.actions.find((a) => a.id === actionId)
        : undefined;
    if (!declared) {
      return NextResponse.json(
        { error: "Esa acción no está declarada en esta solución." },
        { status: 400 }
      );
    }
    if (typeof key !== "string" || !key.trim() || key.length > 200) {
      return NextResponse.json(
        { error: "Falta el registro sobre el que actuar." },
        { status: 400 }
      );
    }
    const current = await pgDatosRepo.get(
      decision.organizationId,
      view.collection,
      key
    );
    if (!current) {
      return NextResponse.json(
        { error: "Ese registro ya no existe." },
        { status: 404 }
      );
    }
    const base =
      current.value &&
      typeof current.value === "object" &&
      !Array.isArray(current.value)
        ? (current.value as Record<string, unknown>)
        : { valor: current.value };
    const saved = await datosSave(pgDatosRepo, decision.organizationId, {
      collection: view.collection,
      key,
      value: { ...base, [view.actionField]: declared.id },
    });
    if (!saved.success) {
      return NextResponse.json({ error: saved.error }, { status: 400 });
    }
    return NextResponse.json({ saved: true, key, action: declared.id });
  } catch {
    return NextResponse.json(
      { error: "No se pudo aplicar la acción." },
      { status: 503 }
    );
  }
}
