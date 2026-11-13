/**
 * Unit tests for attributionPayload() and the readCookie helper in
 * attribution.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur run test:attribution
 *
 * Covers:
 *   - attributionPayload() includes `hubspotutk` when the cookie is set.
 *   - attributionPayload() omits `hubspotutk` when the cookie is absent.
 *   - attributionPayload() reads the correct cookie among several.
 *   - attributionPayload() omits `hubspotutk` when the cookie value is empty.
 *   - attributionPayload() still returns other attribution fields when hutk is absent.
 *   - attributionPayload() reads from first-touch localStorage when present.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Browser environment shims
// ---------------------------------------------------------------------------
// attribution.ts guards every browser API with `typeof window/document`.
// We set up minimal globals so the module behaves as it would in a browser.

type FakeCookieStore = { value: string };
const cookieStore: FakeCookieStore = { value: "" };

// Minimal localStorage shim backed by a plain Map.
const lsStore = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, v); },
  removeItem: (k: string) => { lsStore.delete(k); },
};

// Define window/document on globalThis so the SSR guards pass.
Object.defineProperty(globalThis, "window", {
  value: {
    location: { href: "http://localhost/", origin: "http://localhost" },
    localStorage: fakeLocalStorage,
  },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  get: () => ({ cookie: cookieStore.value, referrer: "" }),
  configurable: true,
});

// ---------------------------------------------------------------------------
// Module under test (imported after shims are installed)
// ---------------------------------------------------------------------------

import { attributionPayload } from "./attribution.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCookie(value: string): void {
  cookieStore.value = value;
}

function clearCookies(): void {
  cookieStore.value = "";
}

function clearLocalStorage(): void {
  lsStore.clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("attributionPayload: includes hubspotutk when the cookie is present", () => {
  clearCookies();
  clearLocalStorage();
  setCookie("hubspotutk=abc-def-123");
  const payload = attributionPayload();
  assert.equal(payload.hubspotutk, "abc-def-123");
});

test("attributionPayload: omits hubspotutk when the cookie is absent", () => {
  clearCookies();
  clearLocalStorage();
  const payload = attributionPayload();
  assert.equal(payload.hubspotutk, undefined);
});

test("attributionPayload: reads the correct cookie among several", () => {
  clearCookies();
  clearLocalStorage();
  setCookie("_ga=GA1.2.xxx; hubspotutk=tok-999; _fbp=fb.1.yyy");
  const payload = attributionPayload();
  assert.equal(payload.hubspotutk, "tok-999");
});

test("attributionPayload: omits hubspotutk when value is empty string", () => {
  clearCookies();
  clearLocalStorage();
  setCookie("hubspotutk=");
  const payload = attributionPayload();
  assert.equal(payload.hubspotutk, undefined);
});

test("attributionPayload: returns other fields even when hutk is absent", () => {
  clearCookies();
  clearLocalStorage();
  // Seed first-touch in localStorage so the payload has something to return.
  lsStore.set(
    "synozur.firstTouch.v1",
    JSON.stringify({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "q3",
      utmTerm: null,
      utmContent: null,
      landingPage: "http://localhost/",
      referrer: null,
      capturedAt: new Date().toISOString(),
    }),
  );
  const payload = attributionPayload();
  assert.equal(payload.utmSource, "google");
  assert.equal(payload.utmMedium, "cpc");
  assert.equal(payload.hubspotutk, undefined);
});

test("attributionPayload: includes both hutk and UTM when both are present", () => {
  clearCookies();
  clearLocalStorage();
  setCookie("hubspotutk=full-flow-token");
  lsStore.set(
    "synozur.firstTouch.v1",
    JSON.stringify({
      utmSource: "linkedin",
      utmMedium: "paid",
      utmCampaign: "summit",
      utmTerm: null,
      utmContent: null,
      landingPage: "http://localhost/summit",
      referrer: "https://linkedin.com",
      capturedAt: new Date().toISOString(),
    }),
  );
  const payload = attributionPayload();
  assert.equal(payload.hubspotutk, "full-flow-token");
  assert.equal(payload.utmSource, "linkedin");
  assert.equal(payload.landingPage, "http://localhost/summit");
});
