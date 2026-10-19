import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, organizations } from "@/lib/db/schema";
import { getOrgSeatUsage } from "@/lib/org-cap";

async function getMembership(request: Request, organizationId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const membership = await db.query.members.findFirst({
    where: and(
      eq(members.organizationId, organizationId),
      eq(members.userId, session.user.id)
    ),
  });
  if (!membership) return null;
  return { userId: session.user.id, role: membership.role };
}

// GET /api/org/member-cap?organizationId=... — seat usage for any member
export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get(
      "organizationId"
    );
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId requerido" },
        { status: 400 }
      );
    }
    const membership = await getMembership(request, organizationId);
    if (!membership) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const usage = await getOrgSeatUsage(organizationId);
    return NextResponse.json(usage);
  } catch (error) {
    console.error("Failed to read member cap:", error);
    return NextResponse.json(
      { error: "No se pudo leer el límite" },
      { status: 500 }
    );
  }
}

// POST /api/org/member-cap { organizationId, memberCap } — owner/admin only
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      organizationId?: string;
      memberCap?: number | null;
    };
    const organizationId = body.organizationId;
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId requerido" },
        { status: 400 }
      );
    }
    const membership = await getMembership(request, organizationId);
    if (!membership) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (membership.role !== "owner" && membership.role !== "admin") {
      return NextResponse.json(
        { error: "Solo el dueño o un admin pueden cambiar el límite." },
        { status: 403 }
      );
    }

    let memberCap: number | null = null;
    if (body.memberCap != null) {
      const n = Number(body.memberCap);
      if (!Number.isInteger(n) || n < 1 || n > 10000) {
        return NextResponse.json(
          { error: "El límite tiene que ser un número entero de 1 a 10000." },
          { status: 400 }
        );
      }
      memberCap = n;
    }

    const usage = await getOrgSeatUsage(organizationId);
    if (memberCap != null && usage.memberCount > memberCap) {
      return NextResponse.json(
        {
          error: `La empresa ya tiene ${usage.memberCount} miembros; el límite no puede ser menor.`,
        },
        { status: 400 }
      );
    }

    await db
      .update(organizations)
      .set({ memberCap })
      .where(eq(organizations.id, organizationId));

    return NextResponse.json({ memberCap });
  } catch (error) {
    console.error("Failed to set member cap:", error);
    return NextResponse.json(
      { error: "No se pudo guardar el límite" },
      { status: 500 }
    );
  }
}
