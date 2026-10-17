import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { MP_AUTH_URL } from "@/plugins/mercadopago/api";

const STATE_COOKIE = "mercadopago_oauth_state";
const VERIFIER_COOKIE = "mercadopago_oauth_verifier";
const POPUP_COOKIE = "mercadopago_oauth_popup";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api/integrations/mercadopago",
  maxAge: 600,
} as const;

/**
 * GET /api/integrations/mercadopago/install
 * Sends the signed-in user to Mercado Pago to authorize our app, with PKCE.
 * Needs MERCADOPAGO_CLIENT_ID / MERCADOPAGO_CLIENT_SECRET (the app is created
 * in the Mercado Pago developer panel, with PKCE enabled and the callback URL
 * registered as its Redirect URL).
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  if (!(clientId && process.env.MERCADOPAGO_CLIENT_SECRET)) {
    return NextResponse.json(
      { error: "Mercado Pago app is not configured on this server yet" },
      { status: 503 }
    );
  }

  const state = randomBytes(24).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  // redirect_uri must match the one registered in the app EXACTLY.
  const redirectUri = new URL(
    "/api/integrations/mercadopago/callback",
    request.url
  ).toString();
  const authorizeUrl = new URL(MP_AUTH_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("platform_id", "mp");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.cookies.set(STATE_COOKIE, state, COOKIE_OPTIONS);
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, COOKIE_OPTIONS);
  if (new URL(request.url).searchParams.get("popup") === "1") {
    response.cookies.set(POPUP_COOKIE, "1", COOKIE_OPTIONS);
  }
  return response;
}
