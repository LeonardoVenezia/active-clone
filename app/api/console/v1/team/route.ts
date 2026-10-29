import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { members, users } from "@/lib/db/schema";
import {consoleMemberships} from "@/lib/console/schema";
import {hasConsoleAffiliation} from "@/lib/console/affiliation";
import { consoleContext } from "@/lib/console/context";
import {
  parseGrant,
  canManageGrant,
  roles,
  type ConsoleRole,
} from "@/lib/console/policy";
export async function GET(request: Request) {
  try {
    const ctx = await consoleContext(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(members)
      .innerJoin(users, eq(members.userId, users.id))
      .where(eq(members.organizationId, ctx.grant.organizationId));
    if(process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED==='true'){
      const extra=await db.select({id:users.id,name:users.name}).from(consoleMemberships).innerJoin(users,eq(consoleMemberships.userId,users.id)).where(and(eq(consoleMemberships.organizationId,ctx.grant.organizationId),eq(consoleMemberships.enabled,true)));
      for(const row of extra)if(!rows.some(r=>r.id===row.id))rows.push(row);
    }
    const { effectiveGrant } = await import("@/lib/console/grants");
    const { assignments } = await import("@/lib/console/data");
    const ownWorkflowIds = assignments(null)
      .filter(
        (a) =>
          a.organizationId === ctx.grant.organizationId &&
          a.teamId &&
          ctx.grant.teamIds.includes(a.teamId),
      )
      .map((a) => a.workflowId);
    const items = (
      await Promise.all(
        rows.map(async (r) => {
          const grant = await effectiveGrant(r.id, ctx.grant.organizationId);
          if (!grant) return null;
          if (ctx.grant.role === "operator" && r.id !== ctx.user.id)
            return null;
          if (
            ctx.grant.role === "manager" &&
            !grant.teamIds.some((t) => ctx.grant.teamIds.includes(t))
          )
            return null;
          return {
            id: r.id,
            name: r.name || "Integrante",
            role: grant.role,
            teamIds:
              ctx.grant.role === "manager"
                ? grant.teamIds.filter((t) => ctx.grant.teamIds.includes(t))
                : grant.teamIds,
            workflowIds:
              ctx.grant.role === "manager"
                ? grant.workflowIds.filter((id) => ownWorkflowIds.includes(id))
                : grant.workflowIds,
            editable:
              canManageGrant(ctx.grant, grant, grant) &&
              (ctx.grant.role !== "manager" ||
                grant.workflowIds.every((id) => ownWorkflowIds.includes(id))),
            canRun: grant.canRun,
          };
        }),
      )
    ).filter(Boolean);
    return NextResponse.json(
      {
        items,
        workflows:(await (await import('@/lib/console/data')).visibleWorkflows(ctx.grant,null)).map(w=>({id:w.id,name:w.name})),teams:[...new Set(assignments(null).filter(a=>a.organizationId===ctx.grant.organizationId&&a.teamId&&(ctx.grant.role!=='manager'||ctx.grant.teamIds.includes(a.teamId))).map(a=>a.teamId))],
        managementAvailable:
          ["owner", "admin", "manager"].includes(ctx.grant.role) &&
          process.env.CONSOLE_STORAGE_ENABLED === "true",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar el equipo." },
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
      !["owner", "admin", "manager"].includes(ctx.grant.role) ||
      process.env.CONSOLE_STORAGE_ENABLED !== "true"
    )
      return NextResponse.json(
        { error: "Gestión no habilitada para esta cuenta." },
        { status: 403 },
      );
    const text = await request.text();
    if (text.length > 4096)
      return NextResponse.json(
        { error: "Datos demasiado grandes." },
        { status: 413 },
      );
    const body = JSON.parse(text);
    if (
      typeof body.userId !== "string" ||
      body.userId === ctx.user.id ||
      !["admin", "manager", "operator"].includes(body.role) ||
      typeof body.enabled !== "boolean" ||
      typeof body.canRun !== "boolean" ||
      !Array.isArray(body.teamIds) ||
      !Array.isArray(body.workflowIds) ||
      [...body.teamIds, ...body.workflowIds].some(
        (x) => typeof x !== "string" || x.length > 128,
      )
    )
      return NextResponse.json(
        { error: "Permisos no válidos." },
        { status: 400 },
      );
    if(!await hasConsoleAffiliation(body.userId,ctx.grant.organizationId))return NextResponse.json({error:'El usuario no pertenece a esta consola.'},{status:403});
    const { effectiveGrant } = await import("@/lib/console/grants");
    const root = await effectiveGrant(body.userId, ctx.grant.organizationId);
    const next = { ...body, organizationId: ctx.grant.organizationId };
    if (!canManageGrant(ctx.grant, root, next))
      return NextResponse.json(
        { error: "No podés cambiar permisos fuera de tu alcance." },
        { status: 403 },
      );
    if (root?.role === "owner")
      return NextResponse.json(
        { error: "No se puede cambiar al titular desde la consola." },
        { status: 403 },
      );
    const { assignments } = await import("@/lib/console/data");
    const permitted = assignments(null).filter(
      (a) => a.organizationId === ctx.grant.organizationId,
    );
    if (
      ctx.grant.role === "manager" &&
      body.workflowIds.some(
        (id: string) =>
          !permitted.some(
            (a) =>
              a.workflowId === id &&
              a.teamId &&
              ctx.grant.teamIds.includes(a.teamId),
          ),
      )
    )
      return NextResponse.json(
        { error: "El workflow está fuera de tu equipo." },
        { status: 403 },
      );
    if (
      body.workflowIds.some(
        (id: string) => !permitted.some((a) => a.workflowId === id),
      ) ||
      body.teamIds.some((id: string) => !permitted.some((a) => a.teamId === id))
    )
      return NextResponse.json(
        { error: "El alcance debe pertenecer a esta empresa." },
        { status: 403 },
      );
    const { consoleGrants, consoleAudit } =
      await import("@/lib/console/schema");
    const { randomUUID } = await import("node:crypto");
    await db.transaction(async (tx) => {
      const values = {
        organizationId: ctx.grant.organizationId,
        userId: body.userId,
        role: body.role,
        teamIds: body.teamIds,
        workflowIds: body.workflowIds,
        canRun: body.canRun,
        enabled: body.enabled,
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      };
      await tx
        .insert(consoleGrants)
        .values(values)
        .onConflictDoUpdate({
          target: [consoleGrants.organizationId, consoleGrants.userId],
          set: values,
        });
      await tx.insert(consoleAudit).values({
        id: randomUUID(),
        organizationId: ctx.grant.organizationId,
        actorId: ctx.user.id,
        subjectId: body.userId,
        action: body.enabled ? "grant.updated" : "grant.disabled",
      });
    });
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos guardar los permisos." },
      { status: 503 },
    );
  }
}
