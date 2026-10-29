import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  members,
  organizations,
  workflows,
  workflowShares,
} from "@/lib/db/schema";
import { managementWorkflowScopes } from "@/lib/console/schema";
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || session.user.isAnonymous)
      return NextResponse.json(
        { error: "Ingresá a tu cuenta." },
        { status: 401 },
      );
    const id = new URL(request.url).searchParams.get("organizationId");
    if (!id)
      return NextResponse.json(
        { error: "Elegí una empresa." },
        { status: 400 },
      );
    const member = await db.query.members.findFirst({
      where: and(
        eq(members.userId, session.user.id),
        eq(members.organizationId, id),
      ),
    });
    if (!member)
      return NextResponse.json(
        { error: "Sin acceso a esta empresa." },
        { status: 403 },
      );
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    const shares = await db
      .select({ id: workflowShares.workflowId })
      .from(workflowShares)
      .where(eq(workflowShares.sharedWithUserId, session.user.id));
    const scopes = await db
      .select({ id: managementWorkflowScopes.workflowId })
      .from(managementWorkflowScopes)
      .where(eq(managementWorkflowScopes.organizationId, id));
    const rows = scopes.length
      ? await db
          .select({
            id: workflows.id,
            name: workflows.name,
            userId: workflows.userId,
            active: workflows.active,
            updatedAt: workflows.updatedAt,
          })
          .from(workflows)
          .where(
            inArray(
              workflows.id,
              scopes.map((s) => s.id),
            ),
          )
      : [];
    return NextResponse.json(
      {
        organization: { id, name: org?.name || "" },
        role: member.role,
        items: rows
          .filter(
            (w) =>
              w.userId === session.user.id || shares.some((s) => s.id === w.id),
          )
          .map(({ userId, ...w }) => w),
        scopeNote:
          "Solo workflows asignados a esta empresa que podés abrir. Los existentes sin asignación siguen en Todos mis workflows.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar los workflows de esta empresa." },
      { status: 503 },
    );
  }
}
