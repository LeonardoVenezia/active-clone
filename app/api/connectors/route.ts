import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { catalog, connect, myConnections, verifyConnection, testConnection } from "@/lib/connectors";
import { flowUsage } from "@/lib/mail-flow";
import { describeToolkit, genericConnect, genericActive } from "@/lib/connectors/generic";
import { PRESETS } from "@/lib/connectors/presets";
const ORIGINS = ["https://active-clone.vercel.app", "https://active-clone-leonardo-venezias-projects.vercel.app"];
async function user(r: Request) { const s = await auth.api.getSession({ headers: r.headers }); return s?.user && !s.user.isAnonymous ? s.user.id : null; }
function fail(e: unknown, status = 503) { return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 500) : "Request failed." }, { status }); }
export async function GET(r: Request) {
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const q = new URL(r.url).searchParams;
  try {
    const page = await catalog({ query: q.get("q") || undefined, cursor: q.get("cursor") || undefined });
    // Reviewed presets are returned separately so they are never buried by catalog search order.
    const connections = await myConnections(id, Object.keys(PRESETS));
    const usage = await flowUsage(id).catch(() => ({} as Record<string, string>));
    for (const list of Object.values(connections)) for (const c of list) if (usage[c.id]) c.usedBy = [usage[c.id]];
    return NextResponse.json({ ...page, connections, featured: Object.values(PRESETS) });
  } catch (e) { return fail(e); }
}
export async function POST(r: Request) {
  const origin = r.headers.get("origin"); if (!origin || !ORIGINS.includes(origin) || new URL(r.url).origin !== origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const id = await user(r); if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const b = await r.json();
    if (typeof b.toolkitId !== "string" || !/^[a-z0-9_]{1,60}$/.test(b.toolkitId)) return fail("Unsupported toolkit.", 400);
    if (b.action === "connect") { const popup = b.popup === true ? "&popup=1" : ""; return NextResponse.json(await connect(id, b.toolkitId, `${origin}/connections?returned=${b.toolkitId}${popup}`)); }
    if (b.action === "verify" && typeof b.connectionId === "string" && /^ca_[A-Za-z0-9_-]+$/.test(b.connectionId)) return NextResponse.json(await verifyConnection(id, b.toolkitId, b.connectionId));
    if (b.action === "test" && typeof b.connectionId === "string" && /^ca_[A-Za-z0-9_-]+$/.test(b.connectionId)) return NextResponse.json(await testConnection(id, b.toolkitId, b.connectionId));
    if (b.action === "describe") return NextResponse.json(await describeToolkit(b.toolkitId));
    if (b.action === "connect_generic") { if (b.acknowledged !== true) return fail("Confirm the permissions notice first.", 400); const popup = b.popup === true ? "&popup=1" : ""; return NextResponse.json(await genericConnect(id, b.toolkitId, `${origin}/connections?returned=${b.toolkitId}${popup}`)); }
    if (b.action === "active") return NextResponse.json({ active: await genericActive(id, b.toolkitId) });
    return fail("Unsupported action.", 400);
  } catch (e) { return fail(e); }
}
