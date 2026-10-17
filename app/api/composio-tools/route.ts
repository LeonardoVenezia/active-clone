import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { catalog } from "@/lib/connectors";
import { getToolkitTool, listToolkitTools } from "@/lib/connectors/generic";
import { listNativeApps } from "@/lib/integrations/directory";

/**
 * GET /api/composio-tools?q=...        search Composio apps for the step picker
 * GET /api/composio-tools?toolkit=...  list one app's actions
 * GET /api/composio-tools?toolkit=...&tool=...  one action with its input schema
 * Same source as /connections (the lib/connectors provider); apps with a
 * native plugin are hidden here too, because native actions already cover them.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAnonymous) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const toolkit = params.get("toolkit");
  try {
    if (toolkit) {
      if (!/^[a-z0-9_]{1,60}$/.test(toolkit)) {
        return NextResponse.json({ error: "Bad toolkit." }, { status: 400 });
      }
      const tool = params.get("tool");
      if (tool) {
        if (!/^[A-Za-z0-9_]{1,80}$/.test(tool)) {
          return NextResponse.json({ error: "Bad tool." }, { status: 400 });
        }
        const item = await getToolkitTool(toolkit, tool);
        if (!item) {
          return NextResponse.json({ error: "Unknown action." }, { status: 404 });
        }
        return NextResponse.json({ item });
      }
      return NextResponse.json({ items: await listToolkitTools(toolkit) });
    }
    const query = (params.get("q") || "").slice(0, 80);
    const page = await catalog({ query: query || undefined });
    const nativeIds = new Set<string>(
      listNativeApps().map((a) => a.id as string)
    );
    const items = page.items
      .filter((t) => !nativeIds.has(t.id))
      .slice(0, 12)
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        logoUrl: t.logoUrl,
      }));
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Request failed.",
      },
      { status: 503 }
    );
  }
}
