import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createIntegration } from "@/lib/db/integrations";
import {
  authHeaders,
  readTiendanubeError,
  storeUrl,
} from "@/plugins/tiendanube/api";

const STATE_COOKIE = "tiendanube_oauth_state";

// Events our Tiendanube triggers listen to (plugins/tiendanube/webhook.ts).
const WEBHOOK_EVENTS = [
  "order/created",
  "order/paid",
  "order/cancelled",
  "product/updated",
];

type TokenResponse = {
  access_token?: string;
  user_id?: string | number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function redirectWithResult(request: Request, result: string) {
  const url = new URL("/connections", request.url);
  url.searchParams.set("tiendanube", result);
  const response = NextResponse.redirect(url);
  response.cookies.delete({
    name: STATE_COOKIE,
    path: "/api/integrations/tiendanube",
  });
  return response;
}

/**
 * GET /api/integrations/tiendanube/callback
 * Tiendanube redirects here with ?code=... after the merchant installs the app.
 * Exchanges the code for a store token, saves the connection and registers
 * the store's webhooks.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const appId = process.env.TIENDANUBE_APP_ID;
  const appSecret = process.env.TIENDANUBE_APP_SECRET;
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
    const tokenResponse = await fetch(
      "https://www.tiendanube.com/apps/authorize/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Credentials go in the JSON body, not the query string (per the docs).
        body: JSON.stringify({
          client_id: appId,
          client_secret: appSecret,
          grant_type: "authorization_code",
          code,
        }),
      }
    );
    const token = (await tokenResponse.json()) as TokenResponse;
    if (!(tokenResponse.ok && token.access_token && token.user_id)) {
      console.error("[Tiendanube OAuth] Token exchange failed");
      return redirectWithResult(request, "token-failed");
    }

    const storeId = String(token.user_id);
    const integration = await createIntegration(
      session.user.id,
      `Tiendanube ${storeId}`,
      "tiendanube",
      { accessToken: token.access_token, storeId }
    );

    // Register webhooks so triggers work. A failure here does not undo the
    // connection; the user can still use the actions.
    const webhookUrl = `${url.origin}/api/integrations/webhooks/tiendanube/${integration.id}`;
    const failures: string[] = [];
    for (const event of WEBHOOK_EVENTS) {
      const response = await fetch(storeUrl(storeId, "/webhooks"), {
        method: "POST",
        headers: authHeaders(token.access_token),
        body: JSON.stringify({ event, url: webhookUrl }),
      });
      if (!response.ok) {
        failures.push(
          `${event}: ${await readTiendanubeError(response, "webhook failed")}`
        );
      }
    }
    if (failures.length > 0) {
      console.error("[Tiendanube OAuth] Webhook registration issues", failures);
      return redirectWithResult(request, "connected-without-webhooks");
    }
    return redirectWithResult(request, "connected");
  } catch (error) {
    console.error("[Tiendanube OAuth] Failed:", error);
    return redirectWithResult(request, "error");
  }
}
