import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { managementWorkflowScopes } from "@/lib/console/schema";
import { dataRecords } from "@/lib/datos/schema";
import { db } from "@/lib/db";
import { members, organizations, workflows } from "@/lib/db/schema";
import { canPrepareLeoDemo, leoDemoPack } from "@/lib/demo/leo-pack";
import { generateId } from "@/lib/utils/id";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 }
    );
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAnonymous) {
    return NextResponse.json(
      { error: "Iniciá sesión con el usuario de demo." },
      { status: 401 }
    );
  }
  if (!canPrepareLeoDemo(process.env.VERCEL_ENV, session.user.email)) {
    return NextResponse.json(
      {
        error:
          "Esta preparación sólo está disponible para la cuenta de demo en preview.",
      },
      { status: 403 }
    );
  }
  const userId = session.user.id;
  const slug = `demo-leo-9nov-${userId}`.toLowerCase();
  try {
    const result = await db.transaction(async (tx) => {
      // One pack per demo user, including concurrent clicks and interrupted retries.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${slug}))`);
      const [existing] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug));
      if (existing) {
        const scopes = await tx
          .select({ id: workflows.id, title: workflows.name })
          .from(managementWorkflowScopes)
          .innerJoin(
            workflows,
            eq(workflows.id, managementWorkflowScopes.workflowId)
          )
          .where(eq(managementWorkflowScopes.organizationId, existing.id));
        return { organizationId: existing.id, items: scopes };
      }
      const organizationId = generateId();
      const now = new Date();
      await tx.insert(organizations).values({
        id: organizationId,
        name: "Demo de Leo - cinco casos ficticios",
        slug,
        createdAt: now,
      });
      await tx.insert(members).values({
        id: generateId(),
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      const pack = leoDemoPack();
      const items: { id: string; title: string }[] = [];
      for (const example of pack.cases) {
        const id = generateId();
        await tx.insert(workflows).values({
          id,
          userId,
          name: example.title,
          nodes: example.nodes,
          edges: example.edges,
          active: false,
          visibility: "private",
        });
        await tx
          .insert(managementWorkflowScopes)
          .values({ workflowId: id, organizationId, assignedBy: userId });
        items.push({ id, title: example.title });
      }
      const reports = pack.cases.flatMap((example) => example.records);
      await tx.insert(dataRecords).values(
        [...pack.seeds, ...reports].map((record) => ({
          ...record,
          organizationId,
        }))
      );
      return { organizationId, items };
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error: "No pudimos preparar la demo. Reintentá sin crear otra cuenta.",
      },
      { status: 503 }
    );
  }
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (
    !session?.user ||
    session.user.isAnonymous ||
    !canPrepareLeoDemo(process.env.VERCEL_ENV, session.user.email)
  ) {
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const slug = `demo-leo-9nov-${session.user.id}`.toLowerCase();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug));
  if (!org) {
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const items = await db
    .select({ id: workflows.id, title: workflows.name })
    .from(managementWorkflowScopes)
    .innerJoin(workflows, eq(workflows.id, managementWorkflowScopes.workflowId))
    .where(eq(managementWorkflowScopes.organizationId, org.id));
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
