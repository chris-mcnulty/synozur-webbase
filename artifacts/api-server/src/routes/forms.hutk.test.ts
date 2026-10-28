/**
 * Unit tests for `extractHutk` in forms.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:forms-hutk
 *
 * Covers:
 *   - Body field value is preferred over cookie when both are present.
 *   - Falls back to the request cookie when body field is absent.
 *   - Returns null when neither source contains the cookie.
 *   - Trims leading/trailing whitespace from the body field value.
 *   - Returns null for empty-string body field (falls through to cookie path).
 *   - Returns null for whitespace-only body field.
 *   - Returns null for empty-string cookie value.
 */

// Disable env vars that the forms module reads at import time so this
// unit test doesn't need a real DB or HubSpot token.
process.env["EMAIL_DISABLED"] = "1";
delete process.env["REPLIT_CONNECTORS_HOSTNAME"];
process.env["HUBSPOT_ACCESS_TOKEN"] = "hs-test-hutk";

import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { extractHutk } from "./forms.js";

// ---------------------------------------------------------------------------
// Minimal Express Request stub
// ---------------------------------------------------------------------------

function makeReq(cookie?: string): Request {
  return {
    cookies: cookie !== undefined ? { hubspotutk: cookie } : {},
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("extractHutk: returns body field when both body and cookie are set", () => {
  const req = makeReq("cookie-value");
  const result = extractHutk(req, { hubspotutk: "body-value" });
  assert.equal(result, "body-value");
});

test("extractHutk: falls back to cookie when body field is absent", () => {
  const req = makeReq("cookie-value-only");
  const result = extractHutk(req, {});
  assert.equal(result, "cookie-value-only");
});

test("extractHutk: returns null when neither body nor cookie is present", () => {
  const req = makeReq(undefined);
  const result = extractHutk(req, {});
  assert.equal(result, null);
});

test("extractHutk: trims whitespace from body field value", () => {
  const req = makeReq(undefined);
  const result = extractHutk(req, { hubspotutk: "  abc123  " });
  assert.equal(result, "abc123");
});

test("extractHutk: empty-string body field falls through to cookie", () => {
  const req = makeReq("fallback-cookie");
  const result = extractHutk(req, { hubspotutk: "" });
  assert.equal(result, "fallback-cookie");
});

test("extractHutk: whitespace-only body field falls through to cookie", () => {
  const req = makeReq("fallback-cookie-ws");
  const result = extractHutk(req, { hubspotutk: "   " });
  assert.equal(result, "fallback-cookie-ws");
});

test("extractHutk: returns null for empty-string cookie with no body field", () => {
  const req = makeReq("");
  const result = extractHutk(req, {});
  assert.equal(result, null);
});

test("extractHutk: null body field falls through to cookie", () => {
  const req = makeReq("null-fallback");
  const result = extractHutk(req, { hubspotutk: null });
  assert.equal(result, "null-fallback");
});
