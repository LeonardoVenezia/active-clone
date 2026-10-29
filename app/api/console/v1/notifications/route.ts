import { NextResponse } from "next/server";
import { consoleContext } from "@/lib/console/context";
import { visibleWorkflows, runHistory } from "@/lib/console/data";
export async function GET(request: Request) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    let showFailures = true;
    const preferencesAvailable = process.env.CONSOLE_STORAGE_ENABLED === "true";
    if (preferencesAvailable) {
      const { db } = await import("@/lib/db");
      const { consolePreferences } = await import("@/lib/console/schema");
      const { and, eq } = await import("drizzle-orm");
      const [pref] = await db
        .select()
        .from(consolePreferences)
        .where(
          and(
            eq(consolePreferences.organizationId, ctx.grant.organizationId),
            eq(consolePreferences.userId, ctx.user.id),
          ),
        );
      showFailures = pref?.showFailures ?? true;
    }
    const flows = await visibleWorkflows(ctx.grant, ctx.organization.metadata);
    const runs = await runHistory(flows.map((x) => x.id));
    const { consoleWorkflowSettings } = await import("@/lib/console/schema");
    const { db } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const settings = preferencesAvailable
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
        items: runs
          .filter(
            (r) =>
              showFailures &&
              r.status === "error" &&
              settings.find((s) => s.workflowId === r.workflowId)
                ?.notifyFailure !== false,
          )
          .map((r) => ({
            id: r.id,
            title: `Revisar ${flows.find((f) => f.id === r.workflowId)?.name || "workflow"}`,
            status: "Corrida fallida",
            description:
              "La agencia debe revisar el resultado. No se reintentó automáticamente.",
          })),
        preferencesAvailable,
        showFailures,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar los avisos." },
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
    if (process.env.CONSOLE_STORAGE_ENABLED !== "true")
      return NextResponse.json(
        { error: "Preferencias todavía no habilitadas." },
        { status: 503 },
      );
    const text = await request.text();
    if (text.length > 256)
      return NextResponse.json(
        { error: "Solicitud no válida." },
        { status: 400 },
      );
    const body = JSON.parse(text);
    if (typeof body.showFailures !== "boolean")
      return NextResponse.json(
        { error: "Preferencia no válida." },
        { status: 400 },
      );
    const { db } = await import("@/lib/db");
    const { consolePreferences } = await import("@/lib/console/schema");
    await db
      .insert(consolePreferences)
      .values({
        organizationId: ctx.grant.organizationId,
        userId: ctx.user.id,
        showFailures: body.showFailures,
      })
      .onConflictDoUpdate({
        target: [consolePreferences.organizationId, consolePreferences.userId],
        set: { showFailures: body.showFailures, updatedAt: new Date() },
      });
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos guardar la preferencia." },
      { status: 503 },
    );
  }
}
