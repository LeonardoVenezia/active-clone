import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, workflowShares, workflows } from "@/lib/db/schema";

// Only the workflow owner manages shares
async function getOwnedWorkflow(workflowId: string, userId: string) {
  return db.query.workflows.findFirst({
    where: and(eq(workflows.id, workflowId), eq(workflows.userId, userId)),
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await context.params;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await getOwnedWorkflow(workflowId, session.user.id))) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  const shares = await db
    .select({
      id: workflowShares.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      createdAt: workflowShares.createdAt,
    })
    .from(workflowShares)
    .innerJoin(users, eq(users.id, workflowShares.sharedWithUserId))
    .where(eq(workflowShares.workflowId, workflowId));
  return NextResponse.json({
    shares: shares.map((share) => ({
      ...share,
      createdAt: share.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await context.params;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await getOwnedWorkflow(workflowId, session.user.id))) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  const body = await request.json();
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  const target = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!target) {
    return NextResponse.json(
      { error: "No existe una cuenta con ese email" },
      { status: 404 }
    );
  }
  if (target.id === session.user.id) {
    return NextResponse.json(
      { error: "El flujo ya es tuyo" },
      { status: 400 }
    );
  }
  await db
    .insert(workflowShares)
    .values({
      workflowId,
      sharedWithUserId: target.id,
      createdByUserId: session.user.id,
    })
    .onConflictDoNothing();
  return NextResponse.json({
    success: true,
    sharedWith: { userId: target.id, email: target.email, name: target.name },
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await context.params;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await getOwnedWorkflow(workflowId, session.user.id))) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  const body = await request.json();
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  await db
    .delete(workflowShares)
    .where(
      and(
        eq(workflowShares.workflowId, workflowId),
        eq(workflowShares.sharedWithUserId, userId)
      )
    );
  return NextResponse.json({ success: true });
}
