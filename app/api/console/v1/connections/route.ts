import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { consoleContext } from "@/lib/console/context";
import { visibleWorkflows } from "@/lib/console/data";
export async function GET(request: Request) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const flows = await visibleWorkflows(ctx.grant, ctx.organization.metadata);
    const ids = new Set<string>();
    for (const f of flows)
      for (const n of f.nodes as any[]) {
        const id = n.data?.config?.integrationId;
        if (typeof id === "string") ids.add(id);
      }
    if (!ids.size) return NextResponse.json({ items: [] });
    const rows = await db
      .select({
        id: integrations.id,
        name: integrations.name,
        type: integrations.type,
        userId: integrations.userId,
      })
      .from(integrations)
      .where(inArray(integrations.id, [...ids]));
    return NextResponse.json(
      {
        items: rows
          .filter((r) =>
            flows.some(
              (f) =>
                f.userId === r.userId &&
                (f.nodes as any[]).some(
                  (n) => n.data?.config?.integrationId === r.id,
                ),
            ),
          )
          .map((r) => ({
            id: r.id,
            name: r.name,
            status: "Configurada · validez no comprobada",
            description: r.type,
          })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar las conexiones." },
      { status: 503 },
    );
  }
}
