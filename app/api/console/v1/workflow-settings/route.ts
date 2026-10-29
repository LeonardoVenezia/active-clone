import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { consoleContext } from "@/lib/console/context";
import { visibleWorkflows } from "@/lib/console/data";
import { consoleWorkflowSettings, consoleAudit } from "@/lib/console/schema";
import { randomUUID } from "node:crypto";
export async function GET(request: Request) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const workflows = await visibleWorkflows(ctx.grant, null);
    const enabled = process.env.CONSOLE_STORAGE_ENABLED === "true";
    const rows = enabled
      ? await db
          .select()
          .from(consoleWorkflowSettings)
          .where(
            eq(
              consoleWorkflowSettings.organizationId,
              ctx.grant.organizationId,
            ),
          )
      : [];
    return NextResponse.json(
      {
        items: workflows.map((w) => {
          const row = rows.find((r) => r.workflowId === w.id);
          return {
            id: w.id,
            name: w.name,
            notifyFailure: row?.notifyFailure ?? true,
            notifyConnection: row?.notifyConnection ?? true,
            notifyApproval: row?.notifyApproval ?? true,
          };
        }),
        editable: enabled && ["owner", "admin"].includes(ctx.grant.role),
        emailDeliveryAvailable: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar los avisos por workflow." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    if (
      !process.env.CONSOLE_ORIGIN ||
      request.headers.get("origin") !== process.env.CONSOLE_ORIGIN
    )
      return NextResponse.json(
        { error: "Origen no permitido." },
        { status: 403 },
      );
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (
      !["owner", "admin"].includes(ctx.grant.role) ||
      process.env.CONSOLE_STORAGE_ENABLED !== "true"
    )
      return NextResponse.json(
        { error: "Configuración no habilitada para tu rol." },
        { status: 403 },
      );
    const text = await request.text();
    if (text.length > 512)
      return NextResponse.json(
        { error: "Solicitud no válida." },
        { status: 400 },
      );
    const body = JSON.parse(text);
    if (
      ["notifyFailure", "notifyConnection", "notifyApproval"].some(
        (k) => typeof body[k] !== "boolean",
      )
    )
      return NextResponse.json(
        { error: "Preferencia no válida." },
        { status: 400 },
      );
    const flows = await visibleWorkflows(ctx.grant, null);
    if (!flows.some((f) => f.id === body.workflowId))
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    await db.transaction(async (tx) => {
      const value = {
        organizationId: ctx.grant.organizationId,
        workflowId: body.workflowId,
        notifyFailure: body.notifyFailure,
        notifyConnection: body.notifyConnection,
        notifyApproval: body.notifyApproval,
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      };
      await tx
        .insert(consoleWorkflowSettings)
        .values(value)
        .onConflictDoUpdate({
          target: [
            consoleWorkflowSettings.organizationId,
            consoleWorkflowSettings.workflowId,
          ],
          set: value,
        });
      await tx.insert(consoleAudit).values({
        id: randomUUID(),
        organizationId: ctx.grant.organizationId,
        actorId: ctx.user.id,
        subjectId: body.workflowId,
        action: "notification.settings.updated",
      });
    });
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos guardar los avisos." },
      { status: 503 },
    );
  }
}
