import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { catalog, connect, myConnections, verifyConnection } from "@/lib/connectors";
import { PRESETS } from "@/lib/connectors/presets";
const ORIGINS = ["https://active-clone.vercel.app", "https://active-clone-leonardo-venezias-projects.vercel.app"];
async function user(r: Request) { const s = await auth.api.getSession({ headers: r.headers }); return s?.user && !s.user.isAnonymous ? s.user.id : null; }
function fail(e: unknown, status = 503) { return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 500) : "Request failed." }, { status }); }
export async function GET(r: Request) {
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const q = new URL(r.url).searchParams;
  try {
    const page = await catalog({ query: q.get("q") || undefined, cursor: q.get("cursor") || undefined });
    // Reviewed toolkits are always listed first on the first page so they are never buried by search order.
    const connections = await myConnections(id, Object.keys(PRESETS));
    return NextResponse.json({ ...page, connections });
  } catch (e) { return fail(e); }
}
export async function POST(r: Request) {
  const origin = r.headers.get("origin"); if (!origin || !ORIGINS.includes(origin) || new URL(r.url).origin !== origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const b = await r.json();
    if (typeof b.toolkitId !== "string" || !/^[a-z0-9_]{1,60}$/.test(b.toolkitId)) return fail("Unsupported toolkit.", 400);
    if (b.action === "connect") return NextResponse.json(await connect(id, b.toolkitId, `${origin}/connections?returned=${b.toolkitId}`));
    if (b.action === "verify" && typeof b.connectionId === "string" && /^ca_[A-Za-z0-9_-]+$/.test(b.connectionId)) return NextResponse.json(await verifyConnection(id, b.toolkitId, b.connectionId));
    return fail("Unsupported action.", 400);
  } catch (e) { return fail(e); }
}
