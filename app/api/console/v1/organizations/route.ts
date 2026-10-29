import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, organizations } from "@/lib/db/schema";
import {consoleMemberships,consoleSessions} from "@/lib/console/schema";
import {hasConsoleAffiliation} from "@/lib/console/affiliation";
import { effectiveGrant } from "@/lib/console/grants";
async function authorized(request: Request) {
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s?.user || s.user.isAnonymous) return null;
  const rows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(members)
    .innerJoin(organizations, eq(members.organizationId, organizations.id))
    .where(eq(members.userId, s.user.id));
  if(process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED==='true'){
    const extra=await db.select({id:organizations.id,name:organizations.name}).from(consoleMemberships).innerJoin(organizations,eq(consoleMemberships.organizationId,organizations.id)).where(and(eq(consoleMemberships.userId,s.user.id),eq(consoleMemberships.enabled,true)));
    for(const row of extra)if(!rows.some(r=>r.id===row.id))rows.push(row);
  }
  return {
    session: s,
    items: (
      await Promise.all(
        rows.map(async (r) =>
          (await hasConsoleAffiliation(s.user.id,r.id)) && (await effectiveGrant(s.user.id, r.id)) ? r : null,
        ),
      )
    ).filter((r): r is { id: string; name: string } => r !== null),
  };
}
export async function GET(request: Request) {
  try {
    const ctx = await authorized(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    return NextResponse.json(
      { items: ctx.items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cargar tus empresas." },
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
    const ctx = await authorized(request);
    if (!ctx)
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const text = await request.text();
    if (text.length > 512)
      return NextResponse.json(
        { error: "Solicitud no válida." },
        { status: 400 },
      );
    const { organizationId } = JSON.parse(text);
    if (!ctx.items.some((r) => r.id === organizationId))
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    if(process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED==='true'){
      await db.insert(consoleSessions).values({sessionId:ctx.session.session.id,organizationId}).onConflictDoUpdate({target:consoleSessions.sessionId,set:{organizationId,updatedAt:new Date()}});
    } else await auth.api.setActiveOrganization({headers:request.headers,body:{organizationId}});
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No pudimos cambiar de empresa." },
      { status: 503 },
    );
  }
}
