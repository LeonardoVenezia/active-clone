import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const STATE_COOKIE = "tiendanube_oauth_state";

/**
 * GET /api/integrations/tiendanube/install
 * Starts the Tiendanube install: sends the signed-in user to the app's
 * authorization page. Needs TIENDANUBE_APP_ID (set once the app exists in the
 * Tiendanube partner portal).
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const appId = process.env.TIENDANUBE_APP_ID;
  if (!(appId && process.env.TIENDANUBE_APP_SECRET)) {
    return NextResponse.json(
      { error: "Tiendanube app is not configured on this server yet" },
      { status: 503 }
    );
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(
    `https://www.tiendanube.com/apps/${encodeURIComponent(appId)}/authorize?state=${state}`
  );
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/integrations/tiendanube",
    maxAge: 600,
  });
  return response;
}
