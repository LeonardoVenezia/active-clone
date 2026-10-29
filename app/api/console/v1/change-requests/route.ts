import { NextResponse } from "next/server";
import { consoleContext } from "@/lib/console/context";
import { visibleWorkflows } from "@/lib/console/data";
import { db } from "@/lib/db";
import { consoleChangeRequests } from "@/lib/console/schema";
import { randomUUID } from "node:crypto";
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
        { error: "Solicitudes todavía no habilitadas." },
        { status: 503 },
      );
    const text = await request.text();
    if (text.length > 4096)
      return NextResponse.json(
        { error: "Solicitud demasiado grande." },
        { status: 413 },
      );
    const body = JSON.parse(text);
    if (
      typeof body.description !== "string" ||
      body.description.trim().length < 5 ||
      body.description.length > 2000
    )
      return NextResponse.json(
        { error: "Describí el cambio entre 5 y 2000 caracteres." },
        { status: 400 },
      );
    const flows = await visibleWorkflows(ctx.grant, null);
    if (!flows.some((f) => f.id === body.workflowId))
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const id = randomUUID();
    await db.insert(consoleChangeRequests).values({
      id,
      organizationId: ctx.grant.organizationId,
      workflowId: body.workflowId,
      actorId: ctx.user.id,
      description: body.description.trim(),
    });
    return NextResponse.json(
      {
        id,
        status: "open",
        delivery: "stored_only",
        message:
          "Solicitud guardada. Todavía no se envió un aviso a la agencia.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos guardar la solicitud." },
      { status: 503 },
    );
  }
}
export async function GET(request: Request) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (process.env.CONSOLE_STORAGE_ENABLED !== "true")
      return NextResponse.json({ items: [], available: false });
    const flows = await visibleWorkflows(ctx.grant, null);
    if (!flows.length) return NextResponse.json({ items: [], available: true });
    const { and, eq, inArray, desc } = await import("drizzle-orm");
    const items = await db
      .select({
        id: consoleChangeRequests.id,
        workflowId: consoleChangeRequests.workflowId,
        description: consoleChangeRequests.description,
        status: consoleChangeRequests.status,
        createdAt: consoleChangeRequests.createdAt,
      })
      .from(consoleChangeRequests)
      .where(
        and(
          eq(consoleChangeRequests.organizationId, ctx.grant.organizationId),
          inArray(
            consoleChangeRequests.workflowId,
            flows.map((f) => f.id),
          ),
          ctx.grant.role === "operator"
            ? eq(consoleChangeRequests.actorId, ctx.user.id)
            : undefined,
        ),
      )
      .orderBy(desc(consoleChangeRequests.createdAt))
      .limit(100);
    return NextResponse.json(
      { items, available: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar las solicitudes." },
      { status: 503 },
    );
  }
}
