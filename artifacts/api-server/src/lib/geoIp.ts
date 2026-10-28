/**
 * Lightweight geo-IP utility for GDPR consent defaults.
 *
 * Uses the ipapi.co HTTPS endpoint (no API key required, free tier supports
 * HTTPS). Any network error or unexpected response returns `null` so form
 * submissions are never blocked by a geo lookup.
 *
 * Privacy notes:
 *   - All requests use HTTPS — visitor IP is encrypted in transit.
 *   - Raw IP addresses are never written to application logs.
 *
 * Only used server-side; never called from the browser.
 */

import { logger } from "./logger.js";

/**
 * ISO 3166-1 alpha-2 codes for the 27 EU member states (as of 2024).
 * These are the jurisdictions where GDPR applies and where we must default
 * `marketingOptIn` to `false` when the visitor has not made an explicit choice.
 */
export const EU_COUNTRY_CODES = new Set<string>([
  "AT", // Austria
  "BE", // Belgium
  "BG", // Bulgaria
  "HR", // Croatia
  "CY", // Cyprus
  "CZ", // Czech Republic
  "DK", // Denmark
  "EE", // Estonia
  "FI", // Finland
  "FR", // France
  "DE", // Germany
  "GR", // Greece
  "HU", // Hungary
  "IE", // Ireland
  "IT", // Italy
  "LV", // Latvia
  "LT", // Lithuania
  "LU", // Luxembourg
  "MT", // Malta
  "NL", // Netherlands
  "PL", // Poland
  "PT", // Portugal
  "RO", // Romania
  "SK", // Slovakia
  "SI", // Slovenia
  "ES", // Spain
  "SE", // Sweden
]);

/** Timeout (ms) for the geo-IP HTTP request — short to stay out of the hot path. */
const GEO_LOOKUP_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------------------
// In-process TTL cache
// ---------------------------------------------------------------------------

/** How long a cached country-code result is considered fresh (10 minutes). */
const CACHE_TTL_MS = 10 * 60 * 1_000;

/** Maximum number of IPs to keep in the cache at once. */
const CACHE_MAX_SIZE = 1_000;

interface CacheEntry {
  /** Resolved country code, or `null` when the lookup failed/returned nothing. */
  value: string | null;
  /** Absolute timestamp (ms) after which this entry is stale. */
  expiresAt: number;
}

/**
 * In-process geo-IP result cache, keyed by normalised IP string.
 *
 * We use a plain `Map` (insertion-ordered) so that evicting the oldest entry
 * is O(1) — just remove `map.keys().next().value`.  Both `null` results
 * (lookup failed) and valid country codes are cached so a broken provider
 * doesn't cause a thundering herd; the short TTL means recovery is automatic.
 */
const geoIpCache = new Map<string, CacheEntry>();

/**
 * Clears the in-process cache entirely.
 *
 * Exported for use in unit tests so that each test starts from a clean slate.
 * Do **not** call this in production paths.
 */
export function clearGeoIpCache(): void {
  geoIpCache.clear();
}

/**
 * Reads a cached entry for `ip`.  Returns `undefined` when there is no entry
 * or the entry has expired (stale entries are deleted on access).
 */
function getCached(ip: string): CacheEntry | undefined {
  const entry = geoIpCache.get(ip);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    geoIpCache.delete(ip);
    return undefined;
  }
  return entry;
}

/**
 * Stores `value` in the cache for `ip`.  Evicts the oldest entry when the
 * cache has reached `CACHE_MAX_SIZE`.
 */
function setCached(ip: string, value: string | null): void {
  // Evict the oldest (first-inserted) entry when the cache is full.
  if (geoIpCache.size >= CACHE_MAX_SIZE) {
    const oldest = geoIpCache.keys().next().value;
    if (oldest !== undefined) geoIpCache.delete(oldest);
  }
  geoIpCache.set(ip, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves an IP address to an ISO 3166-1 alpha-2 country code.
 *
 * Results are cached in-process for {@link CACHE_TTL_MS} (10 min) to avoid
 * hammering ip-api.com's free-tier rate limit (≈45 req/min) when the same
 * visitor triggers multiple form submissions during a session.
 *
 * Returns `null` when:
 *   - `ip` is null, empty, or a private/loopback address (ipapi.co returns
 *     status "fail" for RFC-1918 / ::1 addresses)
 *   - The lookup request times out or returns a non-2xx status
 *   - The response is not parseable JSON or lacks a valid countryCode field
 *
 * Callers must treat `null` as "unknown" and fall through to their own
 * default logic.
 */
export async function lookupCountryCode(ip: string | null): Promise<string | null> {
  if (!ip || ip.trim() === "") return null;

  const normalised = ip.trim();

  // Return the cached result (hit or cached-null) without touching the network.
  const cached = getCached(normalised);
  if (cached) return cached.value;

  const result = await fetchCountryCode(normalised);
  setCached(normalised, result);
  return result;
}

/**
 * Performs the actual HTTP request to ipapi.co.
 * Separated from `lookupCountryCode` so the cache layer is easy to test.
 */
async function fetchCountryCode(ip: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_LOOKUP_TIMEOUT_MS);
  try {
    // ipapi.co uses HTTPS on the free tier and returns only country_code here.
    // We request a minimal field set so as little visitor data as possible
    // traverses the third-party provider.
    const res = await fetch(
      `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { country_code?: string; error?: boolean };
    // ipapi.co sets error:true for reserved/private IPs and invalid input.
    if (json.error === true || typeof json.country_code !== "string") return null;
    const code = json.country_code.trim().toUpperCase();
    return code.length === 2 ? code : null;
  } catch (err) {
    // AbortError = timeout; other network errors are expected occasionally.
    // Do NOT log the IP address — it is personal data (GDPR Art. 4(1)).
    if (err instanceof Error && err.name !== "AbortError") {
      logger.warn({ err }, "geo-IP lookup failed");
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns `true` when the given ISO country code is an EU member state.
 * Safe to call with `null` (returns `false`).
 */
export function isEuCountry(countryCode: string | null | undefined): boolean {
  return countryCode != null && EU_COUNTRY_CODES.has(countryCode.toUpperCase());
}
