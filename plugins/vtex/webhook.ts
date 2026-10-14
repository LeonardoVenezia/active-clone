import { timingSafeEqual } from "node:crypto";
import type {
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
} from "../registry";

// VTEX Order Hook: https://developers.vtex.com/docs/guides/orders-feed
// VTEX POSTs { Domain, OrderId, State, LastChange, Origin } on every order
// update that matches the hook filter, and expects HTTP 200 within 5 seconds.
// Auth: VTEX lets the hook config carry custom headers, so the "Setup Order
// Hook" action registers x-vtex-hook-secret = the connection's Hook Secret and
// we compare it here. When the hook is saved VTEX sends { "hookConfig":
// "ping" } and needs a 200; a ping carries no data, so it is accepted
// without the header and produces no event.

type VtexHookBody = {
  hookConfig?: string;
  Domain?: string;
  OrderId?: string;
  State?: string;
  LastChange?: string;
  Origin?: { Account?: string };
};

function readBody(rawBody: string): VtexHookBody {
  return JSON.parse(rawBody) as VtexHookBody;
}

export const vtexWebhook: IntegrationWebhookHandler = {
  verify(request, credentials) {
    let body: VtexHookBody;
    try {
      body = readBody(request.rawBody);
    } catch {
      return "invalid body";
    }
    if (body.hookConfig === "ping") {
      return null;
    }
    const secret = credentials.VTEX_HOOK_SECRET;
    const header = request.headers.get("x-vtex-hook-secret");
    if (!(secret && header)) {
      return "missing secret";
    }
    const expected = Buffer.from(secret);
    const received = Buffer.from(header);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return "secret mismatch";
    }
    return null;
  },

  parse(request) {
    const body = readBody(request.rawBody);
    if (body.hookConfig === "ping" || !(body.OrderId && body.State)) {
      return [];
    }
    const event: IntegrationWebhookEvent = {
      externalId: `${body.OrderId}:${body.State}:${body.LastChange ?? ""}`,
      trigger: "order-status-changed",
      data: {
        orderId: body.OrderId,
        state: body.State,
        lastChange: body.LastChange ?? "",
        domain: body.Domain ?? "",
      },
    };
    return [event];
  },
};
