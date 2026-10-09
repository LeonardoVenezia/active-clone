import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectGmail, listGmailAccounts, testGmail } from "@/lib/composio-oauth";
const ORIGINS = ["https://active-clone.vercel.app", "https://active-clone-leonardo-venezias-projects.vercel.app"];
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAnonymous) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try { return NextResponse.json({ accounts: await listGmailAccounts(session.user.id) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Connections unavailable." }, { status: 503 }); }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !ORIGINS.includes(origin) || new URL(request.url).origin !== origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAnonymous) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const body = await request.json();
    if (body.action === "connect") return NextResponse.json(await connectGmail(session.user.id, `${origin}/connections?returned=1`));
    if (body.action === "test" && typeof body.id === "string" && /^ca_[A-Za-z0-9_-]+$/.test(body.id)) return NextResponse.json(await testGmail(session.user.id, body.id));
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Connection failed." }, { status: 503 }); }
}
