import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createIntegration } from "@/lib/db/integrations";
import { ML_API_URL } from "@/plugins/mercadolibre/api";

const STATE_COOKIE = "mercadolibre_oauth_state";
const POPUP_COOKIE = "mercadolibre_oauth_popup";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  user_id?: number | string;
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
  url.searchParams.set("mercadolibre", result);
  if (readCookie(request, POPUP_COOKIE) === "1") {
    // Chat connect-card flow: /connections posts back to the opener and closes.
    url.searchParams.set("popup", "1");
    url.searchParams.set("returned", "mercadolibre");
  }
  const response = NextResponse.redirect(url);
  response.cookies.delete({
    name: STATE_COOKIE,
    path: "/api/integrations/mercadolibre",
  });
  response.cookies.delete({
    name: POPUP_COOKIE,
    path: "/api/integrations/mercadolibre",
  });
  return response;
}

/**
 * GET /api/integrations/mercadolibre/callback
 * Mercado Libre redirects here with ?code=...&state=... after the seller
 * authorizes the app. Exchanges the code and saves the connection. Reminder:
 * the seller must log in with the MAIN account, not a collaborator.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const appId = process.env.MERCADOLIBRE_APP_ID;
  const appSecret = process.env.MERCADOLIBRE_APP_SECRET;
  if (!(appId && appSecret)) {
    return redirectWithResult(request, "not-configured");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!(code && state && cookieState && sameState(state, cookieState))) {
    return redirectWithResult(request, "invalid-state");
  }

  try {
    const redirectUri = new URL(
      "/api/integrations/mercadolibre/callback",
      request.url
    ).toString();
    const tokenResponse = await fetch(`${ML_API_URL}/oauth/token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
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
      console.error("[Mercado Libre OAuth] Token exchange failed");
      return redirectWithResult(request, "token-failed");
    }

    const userId = String(token.user_id);
    await createIntegration(
      session.user.id,
      `Mercado Libre ${userId}`,
      "mercadolibre",
      {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        userId,
      }
    );
    return redirectWithResult(request, "connected");
  } catch (error) {
    console.error("[Mercado Libre OAuth] Failed:", error);
    return redirectWithResult(request, "error");
  }
}
