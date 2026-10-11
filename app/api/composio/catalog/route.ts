import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { discoverComposio } from "@/plugins/composio/steps/catalog";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAnonymous) return NextResponse.json({ error: "Sign in to discover Composio tools." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await discoverComposio({ catalog: params.get("catalog") || "toolkits", search: params.get("search") || "", toolkit: params.get("toolkit") || "" }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Discovery unavailable." }, { status: 503 });
  }
}
