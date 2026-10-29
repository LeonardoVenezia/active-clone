import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tiendanubeReconnectAdapter,
  mercadoLibreReconnectAdapter,
} from "../../lib/console/provider-adapters";
import { resendConsoleTransport } from "../../lib/console/mail-transport";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("Tiendanube reconnect matches existing store and never registers webhooks", async () => {
  let calls = 0;
  const adapter = tiendanubeReconnectAdapter(
    { appId: "fixture", appSecret: "fixture", expectedStoreId: "42" },
    async (url, init) => {
      calls++;
      assert.equal(url, "https://www.tiendanube.com/apps/authorize/token");
      assert.equal(init.redirect, "error");
      return json({ access_token: "fixture-only", user_id: 42 });
    },
  );
  assert.equal((await adapter.exchange("fixture")).config.storeId, "42");
  assert.equal(calls, 1);
  const wrong = tiendanubeReconnectAdapter(
    { appId: "fixture", appSecret: "fixture", expectedStoreId: "43" },
    async () => json({ access_token: "fixture-only", user_id: 42 }),
  );
  await assert.rejects(() => wrong.exchange("fixture"));
});
test("Mercado Libre reconnect rejects wrong identity or missing refresh token", async () => {
  for (const token of [
    { access_token: "fixture", refresh_token: "fixture", user_id: 2 },
    { access_token: "fixture", user_id: 1 },
  ]) {
    const adapter = mercadoLibreReconnectAdapter(
      {
        appId: "fixture",
        appSecret: "fixture",
        expectedUserId: "1",
        redirectUri: "https://fixture.invalid/callback",
      },
      async () => json(token),
    );
    await assert.rejects(() => adapter.exchange("fixture"));
  }
  const ok = mercadoLibreReconnectAdapter(
    {
      appId: "fixture",
      appSecret: "fixture",
      expectedUserId: "1",
      redirectUri: "https://fixture.invalid/callback",
    },
    async () =>
      json({ access_token: "fixture", refresh_token: "fixture", user_id: 1 }),
  );
  assert.equal((await ok.exchange("fixture")).verified, true);
});
test("mail is fail-closed and records accepted, not delivered", async () => {
  let calls = 0;
  const http = async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(
      (init.headers as Record<string, string>)["Idempotency-Key"],
      "console/fixture-message-001",
    );
    return json({ id: "provider-fixture" });
  };
  const message = {
    id: "fixture-message-001",
    to: "test@fixture.invalid",
    subject: "Fixture",
    text: "No real delivery",
  };
  await assert.rejects(() =>
    resendConsoleTransport(
      { enabled: false, apiKey: "fixture", from: "test@fixture.invalid" },
      http,
    ).deliver(message),
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await resendConsoleTransport(
      { enabled: true, apiKey: "fixture", from: "test@fixture.invalid" },
      http,
    ).deliver(message),
    { status: "accepted", providerId: "provider-fixture" },
  );
});
test("ambiguous mail never becomes delivered or automatic retry", async () => {
  const message = {
    id: "fixture-message-001",
    to: "test@fixture.invalid",
    subject: "Fixture",
    text: "No real delivery",
  };
  for (const http of [
    async () => json({}, 500),
    async () => json({}, 409),
    async () => json({}, 408),
    async () => json({}),
    async () => {
      throw Error("timeout");
    },
  ])
    assert.deepEqual(
      await resendConsoleTransport(
        { enabled: true, apiKey: "fixture", from: "test@fixture.invalid" },
        http,
      ).deliver(message),
      { status: "unknown" },
    );
});
test("Mercado Libre PKCE verifier is preserved only in token body", async () => {
  const verifier = "a".repeat(43);
  const adapter = mercadoLibreReconnectAdapter(
    {
      appId: "fixture",
      appSecret: "fixture",
      expectedUserId: "1",
      redirectUri: "https://fixture.invalid/callback",
      codeVerifier: verifier,
    },
    async (url, init) => {
      assert(!url.includes(verifier));
      assert.equal(
        (init.body as URLSearchParams).get("code_verifier"),
        verifier,
      );
      return json({
        access_token: "fixture",
        refresh_token: "fixture",
        user_id: 1,
      });
    },
  );
  await adapter.exchange("fixture");
  assert.throws(() =>
    mercadoLibreReconnectAdapter(
      {
        appId: "fixture",
        appSecret: "fixture",
        expectedUserId: "1",
        redirectUri: "https://fixture.invalid/callback",
        codeVerifier: "too-short",
      },
      async () => json({}),
    ),
  );
});
