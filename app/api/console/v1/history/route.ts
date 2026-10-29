import { NextResponse } from "next/server";
import { consoleContext } from "@/lib/console/context";
import { visibleWorkflows, runHistory } from "@/lib/console/data";
export async function GET(request: Request) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const rows = await visibleWorkflows(ctx.grant, ctx.organization.metadata);
    const runs = await runHistory(rows.map((x) => x.id));
    return NextResponse.json(
      {
        items: runs.map((r) => ({
          ...r,
          workflowName: rows.find((w) => w.id === r.workflowId)?.name || "",
        })),
        limit: 100,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar el historial." },
      { status: 503 },
    );
  }
}
