import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ML_AUTH_URL } from "@/plugins/mercadolibre/api";

const STATE_COOKIE = "mercadolibre_oauth_state";
const POPUP_COOKIE = "mercadolibre_oauth_popup";

/**
 * GET /api/integrations/mercadolibre/install
 * Sends the signed-in user to Mercado Libre to authorize our app. Needs
 * MERCADOLIBRE_APP_ID (the app is created in the Mercado Libre DevCenter).
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const appId = process.env.MERCADOLIBRE_APP_ID;
  if (!(appId && process.env.MERCADOLIBRE_APP_SECRET)) {
    return NextResponse.json(
      { error: "Mercado Libre app is not configured on this server yet" },
      { status: 503 }
    );
  }

  const state = randomBytes(24).toString("hex");
  // redirect_uri must match the one registered in the app EXACTLY.
  const redirectUri = new URL(
    "/api/integrations/mercadolibre/callback",
    request.url
  ).toString();
  const authorizeUrl = new URL(ML_AUTH_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", appId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/integrations/mercadolibre",
    maxAge: 600,
  });
  if (new URL(request.url).searchParams.get("popup") === "1") {
    response.cookies.set(POPUP_COOKIE, "1", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/integrations/mercadolibre",
      maxAge: 600,
    });
  }
  return response;
}
