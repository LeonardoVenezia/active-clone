import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVED_PREVIEW_AUTH_ORIGIN,
  approvedPreviewAuthOrigins,
} from "../../lib/auth-preview-origin";

test("approved alias is trusted only in preview, never production or local", () => {
  assert.deepEqual(approvedPreviewAuthOrigins("preview"), [
    APPROVED_PREVIEW_AUTH_ORIGIN,
  ]);
  for (const env of ["production", "development", undefined, "Preview", ""]) {
    assert.deepEqual(approvedPreviewAuthOrigins(env), []);
  }
});

test("preview grant contains no wildcard, sibling host, suffix match or insecure origin", () => {
  const origins = approvedPreviewAuthOrigins("preview");
  assert.equal(origins.length, 1);
  assert.equal(origins[0].includes("*"), false);
  for (const other of [
    "https://unapproved-preview.vercel.app",
    `${APPROVED_PREVIEW_AUTH_ORIGIN}.attacker.invalid`,
    APPROVED_PREVIEW_AUTH_ORIGIN.replace("https:", "http:"),
    "https://active-clone.vercel.app",
  ]) {
    assert.equal(origins.includes(other), false);
  }
});
