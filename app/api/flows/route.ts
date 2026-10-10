import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listFlows, safeFlowError } from "@/lib/mail-flow";
export async function GET(r: Request) {
  const s = await auth.api.getSession({ headers: r.headers });
  if (!s?.user || s.user.isAnonymous) return NextResponse.json({ signedIn: false, flows: [] });
  try { return NextResponse.json({ signedIn: true, flows: await listFlows(s.user.id) }); }
  catch (e) { return NextResponse.json({ error: safeFlowError(e) }, { status: 503 }); }
}
