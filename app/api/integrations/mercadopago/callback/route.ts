import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createIntegration } from "@/lib/db/integrations";
import { MP_TOKEN_URL } from "@/plugins/mercadopago/api";

const STATE_COOKIE = "mercadopago_oauth_state";
const VERIFIER_COOKIE = "mercadopago_oauth_verifier";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  user_id?: number | string;
  expires_in?: number;
};

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function redirectWithResult(request: Request, result: string) {
  const url = new URL("/connections", request.url);
  url.searchParams.set("mercadopago", result);
  const response = NextResponse.redirect(url);
  response.cookies.delete({
    name: STATE_COOKIE,
    path: "/api/integrations/mercadopago",
  });
  response.cookies.delete({
    name: VERIFIER_COOKIE,
    path: "/api/integrations/mercadopago",
  });
  return response;
}

/**
 * GET /api/integrations/mercadopago/callback
 * Mercado Pago redirects here with ?code=...&state=... after the seller
 * authorizes the app. Verifies state, exchanges the code with the PKCE
 * verifier and saves the connection (access + refresh token).
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    return redirectWithResult(request, "not-configured");
  }

  const url = new URL(request.url);
  const denied = url.searchParams.get("error");
  if (denied) {
    return redirectWithResult(request, denied);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readCookie(request, STATE_COOKIE);
  const codeVerifier = readCookie(request, VERIFIER_COOKIE);

  if (
    !(
      code &&
      state &&
      cookieState &&
      codeVerifier &&
      sameState(state, cookieState)
    )
  ) {
    return redirectWithResult(request, "invalid-state");
  }

  try {
    const redirectUri = new URL(
      "/api/integrations/mercadopago/callback",
      request.url
    ).toString();
    const tokenResponse = await fetch(MP_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    const token = (await tokenResponse.json()) as TokenResponse;
    if (
      !(
        tokenResponse.ok &&
        token.access_token &&
        token.refresh_token &&
        token.user_id
      )
    ) {
      console.error("[Mercado Pago OAuth] Token exchange failed");
      return redirectWithResult(request, "token-failed");
    }

    const userId = String(token.user_id);
    await createIntegration(
      session.user.id,
      `Mercado Pago ${userId}`,
      "mercadopago",
      {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        userId,
      }
    );
    return redirectWithResult(request, "connected");
  } catch (error) {
    console.error("[Mercado Pago OAuth] Failed:", error);
    return redirectWithResult(request, "error");
  }
}
