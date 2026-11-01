import { test } from "node:test";
import assert from "node:assert/strict";
import { failureHint } from "../../lib/console/failure-hint";

test("non-error statuses and missing error produce no hint", () => {
  assert.equal(failureHint("success", "x"), null);
  assert.equal(failureHint("error", null), null);
});

test("credential-shaped errors point to Conexiones without leaking detail", () => {
  const hint = failureHint(
    "error",
    'HTTP request failed with status 400: {"message":"invalid_token","token":"MP_TOKEN_FICTICIO_QA_20261101"}',
  );
  assert.ok(hint);
  assert(hint.includes("Conexiones"));
  assert(!hint.includes("MP_TOKEN_FICTICIO"));
  assert(!hint.includes("400"));
});

test("timeout and unknown errors get generic guidance", () => {
  assert(failureHint("error", "fetch timed out after 30s")?.includes("tarde"));
  assert(failureHint("error", "weird internal state")?.includes("agencia"));
});
