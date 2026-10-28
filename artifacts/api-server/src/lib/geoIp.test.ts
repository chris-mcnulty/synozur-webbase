/**
 * Unit tests for the geo-IP utility (geoIp.ts) and the resolveAttribution
 * function in forms.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:geo-ip
 *
 * All HTTP calls are mocked via globalThis.fetch so no real network requests
 * are made. The real DB is used (same pattern as every other test in this
 * workspace) for resolveAttribution tests that must read site_settings.
 *
 * Covers:
 *   lookupCountryCode:
 *     - Returns the country code on a successful ipapi.co response
 *     - Returns null when the response contains error:true (reserved/private IPs)
 *     - Returns null when fetch throws (network error / timeout)
 *     - Returns null when ip is null or empty
 *
 *   isEuCountry:
 *     - Returns true for a known EU country code
 *     - Returns false for a non-EU country code
 *     - Returns false for null
 *
 *   resolveAttribution (via forms.ts export):
 *     - EU IP + no explicit choice → marketingOptIn = false
 *     - Non-EU IP + no explicit choice → falls through to hubspotEuOptInDefault
 *       (default false → optIn = true; when toggle is true → optIn = false)
 *     - Any IP + explicit opt-in → marketingOptIn = true (user choice wins)
 *     - Any IP + explicit opt-out → marketingOptIn = false (user choice wins)
 *     - geo lookup failure (null) + no explicit choice → opt-out (GDPR-safe default)
 *     - subscribe formType always sets optIn = true regardless of IP / default
 */

// Must be set before module imports that read env at import time.
process.env["EMAIL_DISABLED"] = "1";
delete process.env["REPLIT_CONNECTORS_HOSTNAME"];
process.env["HUBSPOT_ACCESS_TOKEN"] = "hs-test-token";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool, siteSettingsTable } from "@workspace/db";

// Close the DB pool once all tests finish so the process exits cleanly.
after(async () => {
  await pool.end();
});
import { lookupCountryCode, isEuCountry, clearGeoIpCache } from "./geoIp.js";
import { resolveAttribution } from "../routes/forms.js";

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockGeoResponse(body: object, ok = true): void {
  globalThis.fetch = async (_url: string | URL | Request) => {
    return {
      ok,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  };
}

function mockGeoNetworkError(): void {
  globalThis.fetch = async () => {
    throw new Error("Network error");
  };
}

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function setSiteEuOptInDefault(value: boolean): Promise<boolean | null> {
  const existing = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.id, 1),
  });
  const prev = existing?.hubspotEuOptInDefault ?? null;
  if (existing) {
    await db
      .update(siteSettingsTable)
      .set({ hubspotEuOptInDefault: value })
      .where(eq(siteSettingsTable.id, 1));
  } else {
    await db.insert(siteSettingsTable).values({ id: 1, hubspotEuOptInDefault: value });
  }
  return prev;
}

async function restoreEuOptInDefault(prev: boolean | null): Promise<void> {
  if (prev === null) {
    // Row didn't exist before; leave it as-is (other tests may need it).
    return;
  }
  await db
    .update(siteSettingsTable)
    .set({ hubspotEuOptInDefault: prev })
    .where(eq(siteSettingsTable.id, 1));
}

/** Minimal MarketingExtension body with no explicit opt-in choice. */
const noChoice = { marketingOptIn: undefined };
/** Explicit opt-in. */
const explicitIn = { marketingOptIn: true };
/** Explicit opt-out. */
const explicitOut = { marketingOptIn: false };

// ---------------------------------------------------------------------------
// lookupCountryCode tests
// ---------------------------------------------------------------------------

test("lookupCountryCode: returns country code on success", async () => {
  clearGeoIpCache();
  // ipapi.co uses country_code (snake_case).
  mockGeoResponse({ country_code: "DE" });
  try {
    const code = await lookupCountryCode("1.2.3.4");
    assert.equal(code, "DE");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode: normalises country code to uppercase", async () => {
  clearGeoIpCache();
  mockGeoResponse({ country_code: "fr" });
  try {
    const code = await lookupCountryCode("1.2.3.4");
    assert.equal(code, "FR");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode: returns null when ipapi.co returns error:true (private/reserved IP)", async () => {
  clearGeoIpCache();
  // ipapi.co sets error:true for RFC-1918 / loopback addresses.
  mockGeoResponse({ error: true, reason: "Reserved IP Address" });
  try {
    const code = await lookupCountryCode("127.0.0.1");
    assert.equal(code, null);
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode: returns null on network error", async () => {
  clearGeoIpCache();
  mockGeoNetworkError();
  try {
    const code = await lookupCountryCode("1.2.3.4");
    assert.equal(code, null);
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode: returns null for null ip", async () => {
  clearGeoIpCache();
  // fetch should not even be called.
  let called = false;
  globalThis.fetch = async () => { called = true; return {} as Response; };
  try {
    const code = await lookupCountryCode(null);
    assert.equal(code, null);
    assert.equal(called, false, "fetch should not be called for null ip");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode: returns null for empty string ip", async () => {
  clearGeoIpCache();
  let called = false;
  globalThis.fetch = async () => { called = true; return {} as Response; };
  try {
    const code = await lookupCountryCode("");
    assert.equal(code, null);
    assert.equal(called, false, "fetch should not be called for empty ip");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode: returns null when response is not ok", async () => {
  clearGeoIpCache();
  mockGeoResponse({}, false);
  try {
    const code = await lookupCountryCode("1.2.3.4");
    assert.equal(code, null);
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

// ---------------------------------------------------------------------------
// Cache tests
// ---------------------------------------------------------------------------

test("lookupCountryCode cache: second call with same IP skips fetch", async () => {
  clearGeoIpCache();
  let fetchCount = 0;
  globalThis.fetch = async (_url: string | URL | Request) => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({ country_code: "AU" }),
      text: async () => '{"country_code":"AU"}',
    } as Response;
  };
  try {
    const first = await lookupCountryCode("8.8.8.8");
    const second = await lookupCountryCode("8.8.8.8");
    assert.equal(first, "AU");
    assert.equal(second, "AU");
    assert.equal(fetchCount, 1, "fetch must only be called once for the same IP");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode cache: different IPs each trigger their own fetch", async () => {
  clearGeoIpCache();
  let fetchCount = 0;
  globalThis.fetch = async (_url: string | URL | Request) => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({ country_code: "US" }),
      text: async () => '{"country_code":"US"}',
    } as Response;
  };
  try {
    await lookupCountryCode("1.1.1.1");
    await lookupCountryCode("2.2.2.2");
    assert.equal(fetchCount, 2, "distinct IPs must each call fetch independently");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode cache: null result (network error) is also cached", async () => {
  clearGeoIpCache();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("Network error");
  };
  try {
    const first = await lookupCountryCode("3.3.3.3");
    const second = await lookupCountryCode("3.3.3.3");
    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(fetchCount, 1, "a null/error result must be cached so the same IP doesn't hammer the provider");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("lookupCountryCode cache: expired entry triggers a fresh fetch", async () => {
  clearGeoIpCache();
  // Manually seed the cache with an already-expired entry by bypassing the
  // public API — we do it via a first real call and then time-travel the entry.
  // Simpler: just call it twice after patching Date.now to be far in the future.
  let fetchCount = 0;
  globalThis.fetch = async (_url: string | URL | Request) => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({ country_code: "JP" }),
      text: async () => '{"country_code":"JP"}',
    } as Response;
  };

  const realDateNow = Date.now;
  try {
    // First call — populates the cache.
    await lookupCountryCode("4.4.4.4");
    assert.equal(fetchCount, 1);

    // Advance time past the 10-minute TTL.
    Date.now = () => realDateNow() + 11 * 60 * 1_000;

    // Second call — cache entry is stale, so fetch fires again.
    const result = await lookupCountryCode("4.4.4.4");
    assert.equal(result, "JP");
    assert.equal(fetchCount, 2, "fetch must be called again after TTL expiry");
  } finally {
    Date.now = realDateNow;
    restoreFetch();
    clearGeoIpCache();
  }
});

// ---------------------------------------------------------------------------
// isEuCountry tests
// ---------------------------------------------------------------------------

test("isEuCountry: returns true for a known EU code (DE)", () => {
  assert.equal(isEuCountry("DE"), true);
});

test("isEuCountry: returns true for all 27 EU member states", () => {
  const euCodes = [
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR",
    "DE","GR","HU","IE","IT","LV","LT","LU","MT","NL",
    "PL","PT","RO","SK","SI","ES","SE",
  ];
  for (const code of euCodes) {
    assert.equal(isEuCountry(code), true, `${code} should be EU`);
  }
});

test("isEuCountry: returns false for a non-EU code (US)", () => {
  assert.equal(isEuCountry("US"), false);
});

test("isEuCountry: returns false for UK (post-Brexit)", () => {
  assert.equal(isEuCountry("GB"), false);
});

test("isEuCountry: returns false for null", () => {
  assert.equal(isEuCountry(null), false);
});

// ---------------------------------------------------------------------------
// resolveAttribution tests
// ---------------------------------------------------------------------------

test("resolveAttribution: EU IP + no explicit choice → opt-out", async () => {
  clearGeoIpCache();
  // DE = Germany (EU)
  mockGeoResponse({ country_code: "DE" });
  try {
    const attr = await resolveAttribution("contact", noChoice, "1.2.3.4");
    assert.equal(attr.marketingOptIn, false, "EU visitor without explicit choice must be opt-out");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("resolveAttribution: non-EU IP + no explicit choice → global default (off = opt-in)", async () => {
  clearGeoIpCache();
  mockGeoResponse({ country_code: "US" });
  const prev = await setSiteEuOptInDefault(false);
  try {
    const attr = await resolveAttribution("contact", noChoice, "1.2.3.4");
    assert.equal(
      attr.marketingOptIn,
      true,
      "Non-EU visitor with default=false toggle must be opted in",
    );
  } finally {
    restoreFetch();
    clearGeoIpCache();
    await restoreEuOptInDefault(prev);
  }
});

test("resolveAttribution: non-EU IP + no explicit choice → global default (on = opt-out)", async () => {
  clearGeoIpCache();
  mockGeoResponse({ country_code: "CA" });
  const prev = await setSiteEuOptInDefault(true);
  try {
    const attr = await resolveAttribution("contact", noChoice, "1.2.3.4");
    assert.equal(
      attr.marketingOptIn,
      false,
      "Non-EU visitor with euOptInDefault=true toggle must be opted out",
    );
  } finally {
    restoreFetch();
    clearGeoIpCache();
    await restoreEuOptInDefault(prev);
  }
});

test("resolveAttribution: any IP + explicit opt-in → opt-in (user choice wins)", async () => {
  clearGeoIpCache();
  // Even an EU IP should not override an explicit opt-in.
  mockGeoResponse({ country_code: "FR" });
  try {
    const attr = await resolveAttribution("contact", explicitIn, "1.2.3.4");
    assert.equal(attr.marketingOptIn, true, "Explicit opt-in must win over geo default");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("resolveAttribution: any IP + explicit opt-out → opt-out (user choice wins)", async () => {
  clearGeoIpCache();
  // Even a non-EU IP + global default=false (→ opt-in) must be overridden.
  mockGeoResponse({ country_code: "AU" });
  const prev = await setSiteEuOptInDefault(false);
  try {
    const attr = await resolveAttribution("contact", explicitOut, "5.6.7.8");
    assert.equal(attr.marketingOptIn, false, "Explicit opt-out must win over geo/global default");
  } finally {
    restoreFetch();
    clearGeoIpCache();
    await restoreEuOptInDefault(prev);
  }
});

test("resolveAttribution: geo lookup fails (network error) → opt-out (GDPR-safe default)", async () => {
  clearGeoIpCache();
  mockGeoNetworkError();
  // When geo location cannot be determined, we must conservatively default to
  // no tracking — this is the GDPR-safe behaviour for unresolvable visitors.
  const prev = await setSiteEuOptInDefault(false); // toggle says "don't require opt-in globally"
  try {
    const attr = await resolveAttribution("contact", noChoice, "1.2.3.4");
    assert.equal(
      attr.marketingOptIn,
      false,
      "Unresolved country must default to opt-out (GDPR-safe), regardless of the backstop toggle",
    );
  } finally {
    restoreFetch();
    clearGeoIpCache();
    await restoreEuOptInDefault(prev);
  }
});

test("resolveAttribution: private/reserved IP (ipapi.co error:true) → opt-out (GDPR-safe default)", async () => {
  clearGeoIpCache();
  mockGeoResponse({ error: true, reason: "Reserved IP Address" });
  const prev = await setSiteEuOptInDefault(false);
  try {
    const attr = await resolveAttribution("contact", noChoice, "127.0.0.1");
    assert.equal(
      attr.marketingOptIn,
      false,
      "Unresolvable/reserved IP must default to opt-out (GDPR-safe)",
    );
  } finally {
    restoreFetch();
    clearGeoIpCache();
    await restoreEuOptInDefault(prev);
  }
});

test("resolveAttribution: subscribe formType always → opt-in regardless of EU IP", async () => {
  clearGeoIpCache();
  // Subscribe is always explicit consent.
  mockGeoResponse({ country_code: "DE" });
  try {
    const attr = await resolveAttribution("subscribe", noChoice, "1.2.3.4");
    assert.equal(attr.marketingOptIn, true, "subscribe must always set opt-in regardless of geo");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});

test("resolveAttribution: UTM fields are forwarded correctly", async () => {
  clearGeoIpCache();
  mockGeoResponse({ country_code: "US" });
  const body = {
    marketingOptIn: undefined,
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "q3-2026",
    utmTerm: "enterprise",
    utmContent: "banner-a",
    landingPage: "/solutions",
    referrer: "https://google.com",
  };
  try {
    const attr = await resolveAttribution("contact", body, "1.2.3.4");
    assert.equal(attr.utm.source, "google");
    assert.equal(attr.utm.medium, "cpc");
    assert.equal(attr.utm.campaign, "q3-2026");
    assert.equal(attr.utm.term, "enterprise");
    assert.equal(attr.utm.content, "banner-a");
    assert.equal(attr.utm.landingPage, "/solutions");
    assert.equal(attr.utm.referrer, "https://google.com");
  } finally {
    restoreFetch();
    clearGeoIpCache();
  }
});
