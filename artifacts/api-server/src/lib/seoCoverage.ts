// #160 — Search Console / Bing index-coverage scanner.
//
// A daily cron (see scheduler.ts) walks every published canonical URL —
// reusing the same enumeration the sitemap is built from — and asks each
// search engine whether the URL is actually in its index:
//
//   - Google: Search Console URL Inspection API
//     (POST searchconsole.googleapis.com/v1/urlInspection/index:inspect).
//     Reuses the GOOGLE_INDEXING_SA_JSON service account from #102 but with
//     the webmasters.readonly scope; the SA must be added as a user on the
//     Search Console property identified by GOOGLE_SEARCH_CONSOLE_SITE_URL.
//   - Bing: Webmaster GetUrlInfo (reuses BING_API_KEY / BING_SITE_URL).
//     Best-effort — the Bing API exposes far less than Search Console.
//
// Every provider is opt-in via env vars and degrades gracefully (no creds →
// bucket "not-configured", never throws) exactly like seoSubmit.ts.

import { GoogleAuth } from "google-auth-library";
import { and, desc, eq, gte, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import {
  db,
  pool,
  seoCoverageStatusTable,
  seoCoverageRunsTable,
  seoCoverageDailySnapshotsTable,
  seoCoverageIndexEventsTable,
  seoResubmittedUrlsTable,
  type SeoCoverageRun,
} from "@workspace/db";
import { collectEntries, classifyArtifactKind } from "../routes/seo";
import { siteOrigin } from "./siteOrigin";
import { logger } from "./logger";
import { submitUrls, type SubmitBundle } from "./seoSubmit";
import {
  type CoverageBucket,
  type GoogleIndexStatusResult,
  type BingUrlInfo,
  normalizeGoogleBucket,
  normalizeBingBucket,
  parseMicrosoftDate,
} from "./seoCoverageBuckets";

export {
  type CoverageBucket,
  type GoogleIndexStatusResult,
  type BingUrlInfo,
  normalizeGoogleBucket,
  normalizeBingBucket,
  parseMicrosoftDate,
} from "./seoCoverageBuckets";

const GOOGLE_SC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GOOGLE_INSPECT_URL =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

const SCAN_CONCURRENCY = 5;
const DEFAULT_MAX_URLS = 1500;
const SEO_REPORTING_TIME_ZONE = "America/Los_Angeles";
// Per-request ceiling so a stalled provider can't hang a worker (and keep
// the scan lock held) indefinitely.
const PROVIDER_TIMEOUT_MS = 10_000;
// Post-scan resubmission is useful but must never keep the coverage scanner
// lock held indefinitely. Individual provider requests have their own shorter
// deadline; this bounds the whole optional phase, including custom clients.
const DEFAULT_RESUBMISSION_TIMEOUT_MS = 30_000;

function resubmissionTimeoutMs(): number {
  const value = Number(process.env.SEO_COVERAGE_RESUBMISSION_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_RESUBMISSION_TIMEOUT_MS;
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`SEO coverage resubmission timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function maxUrls(): number {
  const raw = Number(process.env.SEO_COVERAGE_MAX_URLS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_URLS;
}

function reportingDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEO_REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_INDEXING_SA_JSON?.trim() &&
      process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim(),
  );
}

/**
 * Search Console property identifier, normalized to what the API expects.
 * URL-prefix properties are registered WITH a trailing slash
 * (e.g. `https://www.synozur.com/`) and the URL Inspection API rejects a
 * slash-less variant with "You do not own this site". `sc-domain:` values
 * pass through unchanged.
 */
export function normalizedGoogleSiteUrl(): string {
  const raw = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim() ?? "";
  if (!raw || raw.startsWith("sc-domain:")) return raw;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** The service-account email the owner must add to the Search Console property. */
export function googleServiceAccountEmail(): string | null {
  const sa = process.env.GOOGLE_INDEXING_SA_JSON?.trim();
  if (!sa) return null;
  try {
    const parsed = JSON.parse(sa) as { client_email?: unknown };
    return typeof parsed.client_email === "string" ? parsed.client_email : null;
  } catch {
    return null;
  }
}

export function bingConfigured(): boolean {
  return Boolean(
    process.env.BING_API_KEY?.trim() && process.env.BING_SITE_URL?.trim(),
  );
}

// ─── Testing seam (no live credentials in CI) ────────────────────────────────

type GoogleClient = Awaited<ReturnType<GoogleAuth["getClient"]>>;
type GoogleClientFactory = (saJson: string) => Promise<GoogleClient>;
let googleClientFactory: GoogleClientFactory | null = null;
export function __setGoogleClientFactoryForTesting(
  factory: GoogleClientFactory | null,
): void {
  googleClientFactory = factory;
}

// ─── Provider calls ──────────────────────────────────────────────────────────

interface GoogleProbe {
  bucket: CoverageBucket;
  coverageState: string | null;
  verdict: string | null;
  lastCrawlAt: Date | null;
  raw: unknown;
}

async function makeGoogleClient(): Promise<GoogleClient | null> {
  const sa = process.env.GOOGLE_INDEXING_SA_JSON?.trim();
  if (!sa) return null;
  if (googleClientFactory) return googleClientFactory(sa);
  let credentials: unknown;
  try {
    credentials = JSON.parse(sa);
  } catch {
    logger.warn("seo.coverage: GOOGLE_INDEXING_SA_JSON is not valid JSON");
    return null;
  }
  const auth = new GoogleAuth({
    credentials: credentials as NonNullable<
      ConstructorParameters<typeof GoogleAuth>[0]
    >["credentials"],
    scopes: [GOOGLE_SC_SCOPE],
  });
  return auth.getClient();
}

async function probeGoogle(
  client: GoogleClient,
  siteUrl: string,
  inspectionUrl: string,
): Promise<GoogleProbe> {
  try {
    const res = (await client.request({
      url: GOOGLE_INSPECT_URL,
      method: "POST",
      data: { inspectionUrl, siteUrl },
      timeout: PROVIDER_TIMEOUT_MS,
    })) as { data?: unknown };
    const data = (res.data ?? {}) as {
      inspectionResult?: { indexStatusResult?: GoogleIndexStatusResult };
    };
    const isr = data.inspectionResult?.indexStatusResult ?? null;
    return {
      bucket: normalizeGoogleBucket(isr),
      coverageState: isr?.coverageState ?? null,
      verdict: isr?.verdict ?? null,
      lastCrawlAt: isr?.lastCrawlTime ? new Date(isr.lastCrawlTime) : null,
      raw: isr,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A URL Inspection quota response is operationally different from an
    // authentication or property-access failure: credentials may be healthy,
    // but Google cannot produce a verdict for this URL until quota returns.
    // Keep Google's diagnostic intact for the admin surface, alongside a
    // stable classification that does not depend on an error-message rewrite.
    const classification = isGoogleInspectionQuotaError(msg)
      ? "quota-exhausted"
      : "provider-error";
    return {
      bucket: "error",
      coverageState: null,
      verdict: null,
      lastCrawlAt: null,
      raw: { error: msg, classification },
    };
  }
}

/** Identify URL Inspection quota/rate-limit diagnostics without treating them
 * as credential or Search Console property failures. */
export function isGoogleInspectionQuotaError(message: string): boolean {
  return /\b(quota|rate[ -]?limit|daily[ -]?limit|resource_exhausted|userRateLimitExceeded|dailyLimitExceeded)\b/i.test(
    message,
  );
}

interface BingProbe {
  bucket: CoverageBucket;
  httpStatus: number | null;
  lastCrawlAt: Date | null;
  raw: unknown;
  // True when Bing rejected the call because of rate limiting (HTTP 429 or
  // its idiosyncratic HTTP 400 `{"ErrorCode":5,"Message":"ERROR!!! ThrottleHost"}`).
  // The scan stops probing Bing for the rest of the run once this is seen —
  // every further call would just burn time and come back throttled too.
  throttled: boolean;
}

function bingProbeDelayMs(): number {
  const raw = Number(process.env.BING_PROBE_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 500;
}

type BingProber = (url: string) => Promise<BingProbe>;
export async function probeBing(inspectionUrl: string): Promise<BingProbe> {
  const apiKey = process.env.BING_API_KEY?.trim();
  const siteUrl = process.env.BING_SITE_URL?.trim();
  if (!apiKey || !siteUrl) {
    return {
      bucket: "not-configured",
      httpStatus: null,
      lastCrawlAt: null,
      raw: null,
      throttled: false,
    };
  }
  try {
    const u = new URL(
      "https://ssl.bing.com/webmaster/api.svc/json/GetUrlInfo",
    );
    u.searchParams.set("apikey", apiKey);
    u.searchParams.set("siteUrl", siteUrl);
    u.searchParams.set("url", inspectionUrl);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      PROVIDER_TIMEOUT_MS,
    );
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Capture the body so errors can be categorized. Bing signals rate
      // limiting as HTTP 400 with `{"ErrorCode":5,"Message":"ERROR!!! ThrottleHost"}`
      // (confirmed against the live API) rather than a conventional 429.
      let bodyText = "";
      try {
        bodyText = (await res.text()).slice(0, 500);
      } catch {
        /* body unavailable — categorize on status alone */
      }
      let errorCode: number | null = null;
      let message: string | null = null;
      try {
        const parsed = JSON.parse(bodyText) as {
          ErrorCode?: number;
          Message?: string;
        };
        errorCode = typeof parsed.ErrorCode === "number" ? parsed.ErrorCode : null;
        message = typeof parsed.Message === "string" ? parsed.Message : null;
      } catch {
        /* non-JSON error body — keep raw text */
      }
      const throttled =
        res.status === 429 || /throttle/i.test(message ?? bodyText);
      return {
        bucket: throttled ? "not-checked" : "error",
        httpStatus: null,
        lastCrawlAt: null,
        raw: {
          httpStatus: res.status,
          errorCode,
          message: message ?? (bodyText || null),
          ...(throttled ? { throttled: true } : {}),
        },
        throttled,
      };
    }
    const body = (await res.json()) as { d?: BingUrlInfo | null };
    const d = body.d ?? null;
    return {
      bucket: normalizeBingBucket(d),
      httpStatus: typeof d?.HttpStatus === "number" ? d.HttpStatus : null,
      lastCrawlAt: parseMicrosoftDate(d?.LastCrawledDate),
      raw: d,
      throttled: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      bucket: "error",
      httpStatus: null,
      lastCrawlAt: null,
      raw: { error: msg },
      throttled: false,
    };
  }
}

// ─── Credential preflight ─────────────────────────────────────────────────────

export interface ProviderPreflightResult {
  /** Whether credentials are present in env. */
  configured: boolean;
  /** True when the provider accepted the credentials and the expected property
   * was found. Always false when configured=false. */
  ok: boolean;
  /** Human-readable failure reason; only set when configured && !ok. */
  reason?: string;
  /** The list of Search Console properties visible to the service account.
   * Only populated for Google when ok=true or when property-not-found error. */
  properties?: string[];
}

export interface CredentialPreflightResult {
  google: ProviderPreflightResult;
  bing: ProviderPreflightResult;
}

const GOOGLE_SITES_URL =
  "https://www.googleapis.com/webmasters/v3/sites";

async function checkGoogleCredentials(): Promise<ProviderPreflightResult> {
  const client = await makeGoogleClient();
  if (!client) {
    return { configured: true, ok: false, reason: "Could not initialise Google auth client — check GOOGLE_INDEXING_SA_JSON is valid JSON." };
  }
  const expectedSiteUrl = normalizedGoogleSiteUrl();
  if (!expectedSiteUrl) {
    return { configured: true, ok: false, reason: "GOOGLE_SEARCH_CONSOLE_SITE_URL is empty." };
  }
  try {
    const res = (await client.request({
      url: GOOGLE_SITES_URL,
      method: "GET",
      timeout: PROVIDER_TIMEOUT_MS,
    })) as { data?: { siteEntry?: Array<{ siteUrl?: string }> } };
    const entries = res.data?.siteEntry ?? [];
    const properties = entries.map((e) => e.siteUrl ?? "").filter(Boolean);
    const found = properties.some(
      (p) => p === expectedSiteUrl || p.replace(/\/$/, "") === expectedSiteUrl.replace(/\/$/, ""),
    );
    if (!found) {
      const list = properties.length
        ? properties.join(", ")
        : "(none — service account has no Search Console properties)";
      return {
        configured: true,
        ok: false,
        reason: `Property "${expectedSiteUrl}" not found. Visible properties: ${list}. Add the service account as a user on the correct property in Search Console → Settings → Users and permissions.`,
        properties,
      };
    }
    return { configured: true, ok: true, properties };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { configured: true, ok: false, reason: msg };
  }
}

async function checkBingCredentials(): Promise<ProviderPreflightResult> {
  const apiKey = process.env.BING_API_KEY?.trim();
  const siteUrl = process.env.BING_SITE_URL?.trim();
  if (!apiKey || !siteUrl) {
    return { configured: false, ok: false };
  }
  // Use the site root URL as a lightweight test target.
  const testUrl = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  try {
    const u = new URL("https://ssl.bing.com/webmaster/api.svc/json/GetUrlInfo");
    u.searchParams.set("apikey", apiKey);
    u.searchParams.set("siteUrl", siteUrl);
    u.searchParams.set("url", testUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) {
      return { configured: true, ok: false, reason: `Bing API rejected the key (HTTP ${res.status}). Check BING_API_KEY is correct and the key has Webmaster Tools access.` };
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { ErrorMessage?: string; Message?: string };
        if (body.ErrorMessage) detail = body.ErrorMessage;
        else if (body.Message) detail = body.Message;
      } catch { /* ignore parse errors */ }
      return { configured: true, ok: false, reason: detail };
    }
    // A 200 from GetUrlInfo (even with d=null for an uncrawled URL) means auth worked.
    return { configured: true, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { configured: true, ok: false, reason: msg };
  }
}

/**
 * Lightweight credential preflight — does NOT consume URL Inspection quota.
 * Google: lists Search Console properties via webmasters v3 and verifies the
 *   configured GOOGLE_SEARCH_CONSOLE_SITE_URL is among them.
 * Bing: makes a single GetUrlInfo call to the site root to verify the API key.
 */
export async function checkCredentials(): Promise<CredentialPreflightResult> {
  const gConf = googleConfigured();
  const bConf = bingConfigured();

  const [google, bing] = await Promise.all([
    gConf ? checkGoogleCredentials() : Promise.resolve({ configured: false, ok: false } satisfies ProviderPreflightResult),
    bConf ? checkBingCredentials() : Promise.resolve({ configured: false, ok: false } satisfies ProviderPreflightResult),
  ]);

  return { google, bing };
}

// ─── Scan ────────────────────────────────────────────────────────────────────

const SCAN_STALL_MS = 2 * 60 * 1000;

let scanRunning = false;
let activeScan:
  | {
      runId: string;
      lastProgressAt: Date;
    }
  | null = null;

function activeScanIsStalled(): boolean {
  return (
    scanRunning &&
    (!activeScan || Date.now() - activeScan.lastProgressAt.getTime() > SCAN_STALL_MS)
  );
}

async function touchScanProgress(
  runId: string,
  completedUrl = false,
): Promise<void> {
  const now = new Date();
  if (activeScan?.runId === runId) {
    activeScan.lastProgressAt = now;
  }
  await db
    .update(seoCoverageRunsTable)
    .set({
      lastProgressAt: now,
      ...(completedUrl
        ? {
            completedUrlCount:
              sql`${seoCoverageRunsTable.completedUrlCount} + 1`,
          }
        : {}),
    })
    .where(eq(seoCoverageRunsTable.id, runId));
}

export function isScanRunning(): boolean {
  return scanRunning && !activeScanIsStalled();
}

// Test seam for the same-process stale-owner recovery case. The real
// heartbeat is persisted on the run; this only makes the local owner appear
// stale without waiting two minutes in an integration test.
export function __markActiveScanStalledForTesting(): void {
  if (activeScan) {
    activeScan.lastProgressAt = new Date(Date.now() - SCAN_STALL_MS - 1);
  }
}

// Cross-process single-flight: a Postgres session-level advisory lock so a
// second replica (or a manual scan racing the cron) can't double-consume
// the Search Console URL Inspection quota. Session-level locks must be
// acquired and released on the *same* connection, so keep a dedicated pool
// client for the scan lifetime rather than running lock SQL through Drizzle's
// pooled query interface. The in-memory `scanRunning` flag is just a cheap
// same-process fast path on top of this.
const SCAN_ADVISORY_LOCK_KEY = 4815162342;

let bypassAdvisoryLockForTesting = false;
// `Pool.connect` also has a callback overload, so derive this from a small
// promise-only wrapper rather than from `typeof pool.connect` directly.
async function connectForScanLock() {
  return pool.connect();
}
let scanLockClient: Awaited<ReturnType<typeof connectForScanLock>> | null = null;

async function tryAcquireScanLock(): Promise<boolean> {
  if (bypassAdvisoryLockForTesting) return true;

  const client = await connectForScanLock();
  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [SCAN_ADVISORY_LOCK_KEY],
    );
    if (result.rows[0]?.locked !== true) {
      client.release();
      return false;
    }

    scanLockClient = client;
    return true;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseScanLock(): Promise<void> {
  if (bypassAdvisoryLockForTesting) return;
  const client = scanLockClient;
  scanLockClient = null;
  if (!client) return;

  try {
    await client.query(
      "select pg_advisory_unlock($1)",
      [SCAN_ADVISORY_LOCK_KEY],
    );
  } catch {
    /* The lock auto-releases when this dedicated session closes. */
  } finally {
    client.release();
  }
}

export interface ScanResult {
  urlCount: number;
  googleChecked: number;
  bingChecked: number;
  googleConfigured: boolean;
  bingConfigured: boolean;
  skipped: boolean;
  resubmittedCount: number;
}

export interface ScanStartResult {
  started: boolean;
  status: "started" | "already-running" | "scanner-held";
  runId?: string;
}

type ScanStartSignal = (result: ScanStartResult) => void;

/**
 * Begin a scan in the background and report whether this request actually
 * obtained the scanner. The caller gets a definite answer after the advisory
 * lock and run-history row are created, rather than a hopeful 202 response.
 */
export async function startSeoCoverageScan(
  trigger: "scheduled" | "manual" = "scheduled",
): Promise<ScanStartResult> {
  return new Promise<ScanStartResult>((resolve, reject) => {
    void runSeoCoverageScan(trigger, resolve).catch(reject);
  });
}

/**
 * Walk every published canonical URL and refresh its index-coverage row.
 * Safe to call concurrently — a second invocation while one is in flight
 * returns `{ skipped: true }` instead of double-scanning.
 */
export async function runSeoCoverageScan(
  trigger: "scheduled" | "manual" = "scheduled",
  onStarted?: ScanStartSignal,
): Promise<ScanResult> {
  const gConf = googleConfigured();
  const bConf = bingConfigured();
  // A stale owner is a recovery state for the dashboard, but it still owns
  // the session-level advisory lock. Do not clear the same-process guard and
  // try to reacquire: PostgreSQL advisory locks are re-entrant per session,
  // so a pooled connection could otherwise start a second concurrent scan.
  if (scanRunning) {
    const status = activeScanIsStalled() ? "scanner-held" : "already-running";
    if (status === "scanner-held") {
    logger.warn(
      { runId: activeScan?.runId },
        "seo.coverage scan is stalled but still owns the scanner",
    );
    }
    onStarted?.({ started: false, status, runId: activeScan?.runId });
    return {
      urlCount: 0,
      googleChecked: 0,
      bingChecked: 0,
      googleConfigured: gConf,
      bingConfigured: bConf,
      skipped: true,
      resubmittedCount: 0,
    };
  }
  scanRunning = true;

  if (!(await tryAcquireScanLock())) {
    scanRunning = false;
    onStarted?.({ started: false, status: "scanner-held" });
    return {
      urlCount: 0,
      googleChecked: 0,
      bingChecked: 0,
      googleConfigured: gConf,
      bingConfigured: bConf,
      skipped: true,
      resubmittedCount: 0,
    };
  }

  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger,
      googleConfigured: gConf,
      bingConfigured: bConf,
      lastProgressAt: new Date(),
    })
    .returning({ id: seoCoverageRunsTable.id });

  activeScan = { runId: run.id, lastProgressAt: new Date() };
  onStarted?.({ started: true, status: "started", runId: run.id });

  let googleChecked = 0;
  let bingChecked = 0;
  let bingThrottled = false;
  let urlCount = 0;
  const scanStartedAt = new Date();
  try {
    const origin = siteOrigin();
    const entries = entriesOverrideForTesting
      ? (await entriesOverrideForTesting()).map((loc) => ({ loc }))
      : await collectEntries();
    const sitemapUrls = Array.from(new Set(entries.map((e) => e.loc)));
    const urls = sitemapUrls.slice(0, maxUrls());
    urlCount = sitemapUrls.length;
    await db
      .update(seoCoverageRunsTable)
      .set({ urlCount })
      .where(eq(seoCoverageRunsTable.id, run.id));
    await touchScanProgress(run.id);

    // The provider queue is capped, but the dashboard inventory is not.
    // Persist every current sitemap URL before inspection so over-cap URLs
    // remain visible as pending rather than disappearing from their artifact
    // totals. Keep lastSeenAt separate from lastCheckedAt: the latter means a
    // provider actually returned a result for this URL.
    for (let i = 0; i < sitemapUrls.length; i += 100) {
      const now = new Date();
      await db
        .insert(seoCoverageStatusTable)
        .values(
          sitemapUrls.slice(i, i + 100).map((fullUrl) => {
            const path = fullUrl.startsWith(origin)
              ? fullUrl.slice(origin.length) || "/"
              : fullUrl;
            return {
              url: fullUrl,
              path,
              artifactKind: classifyArtifactKind(path),
              lastSeenAt: scanStartedAt,
              updatedAt: now,
            };
          }),
        )
        .onConflictDoUpdate({
          target: seoCoverageStatusTable.url,
          set: {
            lastSeenAt: scanStartedAt,
            updatedAt: now,
          },
        });
    }

    const googleClient = gConf ? await makeGoogleClient() : null;
    const googleSiteUrl = normalizedGoogleSiteUrl();
    const coverageRunDate = reportingDate(scanStartedAt);
    const priorRows = await db
      .select({
        url: seoCoverageStatusTable.url,
        googleBucket: seoCoverageStatusTable.googleBucket,
        bingBucket: seoCoverageStatusTable.bingBucket,
        bingCheckedAt: seoCoverageStatusTable.bingCheckedAt,
      })
      .from(seoCoverageStatusTable);
    const priorByUrl = new Map(priorRows.map((row) => [row.url, row]));
    const newlyIndexedEvents: Array<{
      provider: "google" | "bing";
      url: string;
      artifactKind: string;
      previousBucket: string;
    }> = [];

    // Bing's quota only covers a few dozen probes per run, so rotate it:
    // URLs that have never had a successful Bing verdict go first, then the
    // rest ordered by how long ago their last successful Bing check was.
    // Combined with "throttled probes never overwrite a prior verdict"
    // below, this makes the unchecked/error bucket shrink every run instead
    // of the same first ~40 URLs re-consuming the quota each time.
    const queue = [...urls];
    if (bConf) {
      const checkedAt = new Map(
        priorRows.map((r) => [r.url, r.bingCheckedAt?.getTime() ?? 0]),
      );
      queue.sort(
        (a, b) => (checkedAt.get(a) ?? 0) - (checkedAt.get(b) ?? 0),
      );
    }

    // Serialize + pace Bing calls across workers; once a throttle response
    // is seen, the queue stops hitting the network for the rest of the run.
    const bingQueue = createBingProbeQueue();
    let bingThrottleWarned = false;
    async function worker() {
      for (;;) {
        const fullUrl = queue.shift();
        if (!fullUrl) return;
        const path = fullUrl.startsWith(origin)
          ? fullUrl.slice(origin.length) || "/"
          : fullUrl;
        const kind = classifyArtifactKind(path);

        const set: Record<string, unknown> = {
          path,
          artifactKind: kind,
          lastSeenAt: scanStartedAt,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        };

        if (googleClient) {
          const g = await probeGoogle(googleClient, googleSiteUrl, fullUrl);
          set.googleBucket = g.bucket;
          set.googleCoverageState = g.coverageState;
          set.googleVerdict = g.verdict;
          set.googleLastCrawlAt = g.lastCrawlAt;
          set.googleRaw = g.raw;
          if (g.bucket !== "error") googleChecked += 1;
          const priorGoogleBucket = priorByUrl.get(fullUrl)?.googleBucket;
          // Count only an explicit "not indexed" → "indexed" transition.
          // An unknown/error → indexed response cannot prove the page was
          // newly added to the index, so it stays out of the daily evidence.
          if (
            g.bucket === "indexed" &&
            priorGoogleBucket === "discovered-not-indexed"
          ) {
            newlyIndexedEvents.push({
              provider: "google",
              url: fullUrl,
              artifactKind: kind,
              previousBucket: priorGoogleBucket,
            });
          }
        } else {
          set.googleBucket = "not-configured";
        }

        if (!bConf) {
          set.bingBucket = "not-configured";
        } else {
          const b = await bingQueue.enqueue(fullUrl);
          if (b.throttled) {
            bingThrottled = true;
            if (!bingThrottleWarned && !b.skippedThrottled) {
              bingThrottleWarned = true;
              logger.warn(
                { url: fullUrl, raw: b.raw },
                "seo.coverage: Bing throttled — skipping Bing for the rest of this run",
              );
            }
            // Fall through to the throttled/skip branch below: never
            // overwrite a previously stored verdict with throttle noise.
          } else {
            set.bingBucket = b.bucket;
            set.bingHttpStatus = b.httpStatus;
            set.bingLastCrawlAt = b.lastCrawlAt;
            set.bingRaw = b.raw;
            if (b.bucket !== "not-configured" && b.bucket !== "error") {
              bingChecked += 1;
              set.bingCheckedAt = new Date();
            }
            const priorBingBucket = priorByUrl.get(fullUrl)?.bingBucket;
            if (
              b.bucket === "indexed" &&
              priorBingBucket === "discovered-not-indexed"
            ) {
              newlyIndexedEvents.push({
                provider: "bing",
                url: fullUrl,
                artifactKind: kind,
                previousBucket: priorBingBucket,
              });
            }
          }
        }
        // Throttled or skipped: keep whatever Bing verdict the row already
        // has (omit Bing fields from the upsert `set`), except relabel a
        // missing bucket, or an "error" that is positively identified as
        // throttle noise (the legacy bare `{"httpStatus": 400}` record, a
        // Throttle* message, or an explicit throttled flag), as
        // "not-checked". Real errors (InvalidUrl, auth failures, timeouts)
        // keep their "error" bucket.
        const bingSkipped = bConf && !("bingBucket" in set);
        if (bingSkipped) {
          set.bingBucket = sql`CASE
            WHEN ${seoCoverageStatusTable.bingBucket} IS NULL THEN 'not-checked'
            WHEN ${seoCoverageStatusTable.bingBucket} = 'error' AND (
              ${seoCoverageStatusTable.bingRaw} = '{"httpStatus": 400}'::jsonb
              OR ${seoCoverageStatusTable.bingRaw}->>'message' ILIKE '%throttle%'
              OR ${seoCoverageStatusTable.bingRaw}->>'throttled' = 'true'
            ) THEN 'not-checked'
            ELSE ${seoCoverageStatusTable.bingBucket}
          END`;
        }

        await db
          .insert(seoCoverageStatusTable)
          .values({
            url: fullUrl,
            path,
            artifactKind: kind,
            googleBucket: (set.googleBucket as string) ?? null,
            googleCoverageState: (set.googleCoverageState as string) ?? null,
            googleVerdict: (set.googleVerdict as string) ?? null,
            googleLastCrawlAt: (set.googleLastCrawlAt as Date) ?? null,
            googleRaw: set.googleRaw ?? null,
            // For rows that were skipped due to throttling, the update-side
            // `set.bingBucket` is a SQL CASE expression; a brand-new row has
            // no prior verdict, so insert "not-checked" directly.
            bingBucket: bingSkipped
              ? "not-checked"
              : ((set.bingBucket as string) ?? null),
            bingHttpStatus: (set.bingHttpStatus as number) ?? null,
            bingLastCrawlAt: (set.bingLastCrawlAt as Date) ?? null,
            bingRaw: bingSkipped
              ? { skipped: "bing-throttled" }
              : (set.bingRaw ?? null),
            bingCheckedAt: (set.bingCheckedAt as Date) ?? null,
            lastSeenAt: scanStartedAt,
            lastCheckedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: seoCoverageStatusTable.url,
            set,
          });
        await touchScanProgress(run.id, true);
      }
    }
    const workerCount = Math.min(SCAN_CONCURRENCY, urls.length || 1);
    await Promise.all(Array.from({ length: workerCount }, worker));

    if (newlyIndexedEvents.length > 0) {
      await db
        .insert(seoCoverageIndexEventsTable)
        .values(
          newlyIndexedEvents.map((event) => ({
            eventDate: coverageRunDate,
            provider: event.provider,
            runId: run.id,
            url: event.url,
            artifactKind: event.artifactKind,
            previousBucket: event.previousBucket,
          })),
        )
        .onConflictDoNothing();
    }

    // Drop rows for URLs that are no longer published (unpublished /
    // deleted): every URL in the full sitemap inventory has lastSeenAt set
    // above, so anything older than the scan start was not re-seen and is
    // stale. Treat null as stale too so rows from before lastSeenAt existed
    // are cleaned up on the first scan after this migration.
    // Skipped under the test enumeration override, whose partial URL set
    // would otherwise wipe every real row.
    if (!entriesOverrideForTesting) {
      await db
        .delete(seoCoverageStatusTable)
        .where(
          or(
            isNull(seoCoverageStatusTable.lastSeenAt),
            lt(seoCoverageStatusTable.lastSeenAt, scanStartedAt),
          ),
        );
    }

    // The scan remains active through snapshots and resubmission because the
    // advisory lock is still held. Keep a durable heartbeat until every
    // lock-held phase ends so another replica never reports it as idle.
    await db
      .update(seoCoverageRunsTable)
      .set({
        urlCount,
        googleChecked,
        bingChecked,
        bingThrottled,
        lastProgressAt: new Date(),
      })
      .where(eq(seoCoverageRunsTable.id, run.id));

    await recordDailyCoverageSnapshots({
      runId: run.id,
      snapshotDate: coverageRunDate,
      sitemapUrlCount: urlCount,
      googleChecked,
      bingChecked,
      googleConfigured: gConf,
      bingConfigured: bConf,
    });

    // ── Post-scan resubmission ──────────────────────────────────────────────
    // Query for all URLs currently classified as "discovered-not-indexed"
    // (prefer Google bucket, fall back to Bing as the overview query does),
    // then nudge search engines to re-evaluate them. A submission failure must
    // never surface as a scan error — the run record is already written above.
    const RESUBMIT_CAP = 500;
    let resubmittedCount = 0;
    let resubmissionError: string | null = null;
    try {
      await touchScanProgress(run.id);
      const VALID_BUCKETS_FOR_FALLBACK = [
        "indexed",
        "discovered-not-indexed",
        "crawl-error",
        "soft-404",
        "unknown",
      ] as const;
      const notIndexedRows = await db
        .select({ url: seoCoverageStatusTable.url })
        .from(seoCoverageStatusTable)
        .where(
          or(
            eq(seoCoverageStatusTable.googleBucket, "discovered-not-indexed"),
            and(
              or(
                isNull(seoCoverageStatusTable.googleBucket),
                notInArray(seoCoverageStatusTable.googleBucket, [
                  ...VALID_BUCKETS_FOR_FALLBACK,
                ]),
              ),
              eq(seoCoverageStatusTable.bingBucket, "discovered-not-indexed"),
            ),
          )!,
        )
        .limit(RESUBMIT_CAP);

      const resubmitUrls = notIndexedRows.map((r) => r.url);
      if (resubmitUrls.length > 0) {
        const submitFn = submitUrlsImpl ?? submitUrls;
        await touchScanProgress(run.id);
        const bundle: SubmitBundle = await withDeadline(
          submitFn(origin, resubmitUrls),
          resubmissionTimeoutMs(),
        );
        await touchScanProgress(run.id);
        // Count as resubmitted only when at least one channel accepted the
        // URLs. If every channel is unconfigured or fails, report 0 so the
        // dashboard doesn't falsely claim URLs were nudged.
        resubmittedCount = Math.max(0, ...bundle.results.map((r) => r.submitted));

        // Persist all attempted URLs so admins can drill into a past run and
        // see what was nudged, then compare against the current coverage status.
        // We record all candidates (not just a slice) because each submission
        // channel processes the full list independently; the resubmittedCount
        // field on the run tracks how many the best channel accepted.
        if (resubmitUrls.length > 0) {
          const urlsToRecord = resubmitUrls.map((url) => {
            const path = url.startsWith(origin)
              ? url.slice(origin.length) || "/"
              : url;
            return {
              runId: run.id,
              url,
              path,
              artifactKind: classifyArtifactKind(path),
            };
          });
          // Insert in batches of 100 to stay within parameter limits.
          for (let i = 0; i < urlsToRecord.length; i += 100) {
            await db
              .insert(seoResubmittedUrlsTable)
              .values(urlsToRecord.slice(i, i + 100));
          }
        }
      }

    } catch (resubErr) {
      resubmissionError =
        resubErr instanceof Error ? resubErr.message : String(resubErr);
      logger.error(
        { err: resubErr },
        "seo.coverage: resubmission of not-indexed URLs failed (scan result unchanged)",
      );
    }

    // Only a terminal run can be considered idle by the dashboard. This must
    // happen after every lock-held phase, including bounded resubmission.
    await db
      .update(seoCoverageRunsTable)
      .set({
        finishedAt: new Date(),
        urlCount,
        googleChecked,
        bingChecked,
        bingThrottled,
        resubmittedCount,
        error: resubmissionError,
        lastProgressAt: new Date(),
      })
      .where(eq(seoCoverageRunsTable.id, run.id));

    logger.info(
      {
        urlCount,
        googleChecked,
        bingChecked,
        bingThrottled,
        resubmittedCount,
        trigger,
      },
      "seo.coverage scan complete",
    );
    return {
      urlCount,
      googleChecked,
      bingChecked,
      googleConfigured: gConf,
      bingConfigured: bConf,
      skipped: false,
      resubmittedCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(seoCoverageRunsTable)
      .set({
        finishedAt: new Date(),
        error: msg,
        urlCount,
        googleChecked,
        bingChecked,
        bingThrottled,
      })
      .where(eq(seoCoverageRunsTable.id, run.id));
    logger.error({ err }, "seo.coverage scan failed");
    throw err;
  } finally {
    await releaseScanLock();
    if (activeScan?.runId === run.id) {
      activeScan = null;
      scanRunning = false;
    }
  }
}

// ─── Aggregation for the dashboard ───────────────────────────────────────────

export interface KindBuckets {
  kind: string;
  // Every current crawlable sitemap URL for this kind, including URLs for
  // which neither provider could return a usable coverage result.
  total: number;
  // URLs with a usable Google or Bing inspection result. The individual
  // coverage buckets below sum to this figure.
  inspected: number;
  // URLs still awaiting a usable provider result (quota, throttle,
  // configuration, or transient provider failure). They remain inventory.
  pendingInspection: number;
  indexed: number;
  discoveredNotIndexed: number;
  crawlError: number;
  soft404: number;
  unknown: number;
}

export interface CoverageOverview {
  lastRun: SeoCoverageRunWithProgress | null;
  googleConfigured: boolean;
  bingConfigured: boolean;
  byKind: KindBuckets[];
  indexingTrends: IndexingTrends;
  scanRunning: boolean;
  // True when the latest scan encountered a Google URL Inspection quota or
  // rate limit. This is deliberately distinct from an auth/property warning.
  googleQuotaWarning: boolean;
  // True when Google is configured but returned 0 successful checks on the
  // last run without a quota diagnostic — signals a scope/property issue.
  googleAuthWarning: boolean;
  // The raw diagnostic from the current Google quota/access failure, if any.
  googleLastError: string | null;
  // Actionable remediation details for the auth warning: exactly which
  // service-account email must be granted access to which Search Console
  // property. Only set when googleAuthWarning is true.
  googleServiceAccountEmail: string | null;
  googleSiteUrl: string | null;
  // True when Bing is configured, at least one URL was processed, and the run
  // checked 0 Bing URLs — typically because the quota was exhausted by a
  // prior run and the first call came back throttled.
  bingThrottleWarning: boolean;
}

export interface SeoCoverageRunProgress {
  state: "running" | "stalled";
  completedUrlCount: number;
  totalUrlCount: number;
  lastProgressAt: Date | null;
}

export type SeoCoverageRunWithProgress = SeoCoverageRun & {
  progress: SeoCoverageRunProgress | null;
};

const COVERAGE_BUCKET_VALUES = [
  "indexed",
  "discovered-not-indexed",
  "crawl-error",
  "soft-404",
  "unknown",
] as const;

const VALID_COVERAGE_BUCKETS = new Set<string>(COVERAGE_BUCKET_VALUES);

interface DailySnapshotInput {
  runId: string;
  snapshotDate: string;
  sitemapUrlCount: number;
  googleChecked: number;
  bingChecked: number;
  googleConfigured: boolean;
  bingConfigured: boolean;
}

/**
 * Save one provider-specific daily snapshot after a run has refreshed the
 * live status rows. A later complete scan can replace an earlier partial one
 * on the same reporting day; an incomplete retry can never replace a
 * complete baseline.
 */
async function recordDailyCoverageSnapshots(
  input: DailySnapshotInput,
): Promise<void> {
  const buckets = await db
    .select({
      googleBucket: seoCoverageStatusTable.googleBucket,
      bingBucket: seoCoverageStatusTable.bingBucket,
      count: sql<number>`count(*)::int`,
    })
    .from(seoCoverageStatusTable)
    .groupBy(
      seoCoverageStatusTable.googleBucket,
      seoCoverageStatusTable.bingBucket,
    );

  const countFor = (provider: "google" | "bing", bucket: string) =>
    buckets.reduce((total, row) => {
      const value =
        provider === "google" ? row.googleBucket : row.bingBucket;
      return total + (value === bucket ? row.count : 0);
    }, 0);

  const values = [
    {
      snapshotDate: input.snapshotDate,
      provider: "google",
      runId: input.runId,
      sitemapUrlCount: input.sitemapUrlCount,
      checkedUrlCount: input.googleChecked,
      indexedUrlCount: countFor("google", "indexed"),
      discoveredNotIndexedCount: countFor(
        "google",
        "discovered-not-indexed",
      ),
      isComplete:
        input.googleConfigured &&
        input.sitemapUrlCount > 0 &&
        input.googleChecked >= input.sitemapUrlCount,
      updatedAt: new Date(),
    },
    {
      snapshotDate: input.snapshotDate,
      provider: "bing",
      runId: input.runId,
      sitemapUrlCount: input.sitemapUrlCount,
      checkedUrlCount: input.bingChecked,
      indexedUrlCount: countFor("bing", "indexed"),
      discoveredNotIndexedCount: countFor(
        "bing",
        "discovered-not-indexed",
      ),
      isComplete:
        input.bingConfigured &&
        input.sitemapUrlCount > 0 &&
        input.bingChecked >= input.sitemapUrlCount,
      updatedAt: new Date(),
    },
  ];

  await db
    .insert(seoCoverageDailySnapshotsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        seoCoverageDailySnapshotsTable.snapshotDate,
        seoCoverageDailySnapshotsTable.provider,
      ],
      set: {
        runId: sql`excluded.run_id`,
        sitemapUrlCount: sql`excluded.sitemap_url_count`,
        checkedUrlCount: sql`excluded.checked_url_count`,
        indexedUrlCount: sql`excluded.indexed_url_count`,
        discoveredNotIndexedCount: sql`excluded.discovered_not_indexed_count`,
        isComplete: sql`excluded.is_complete`,
        updatedAt: new Date(),
      },
      where: sql`excluded.is_complete OR NOT ${seoCoverageDailySnapshotsTable.isComplete}`,
    });
}

export interface IndexingTrendDay {
  date: string;
  sitemapUrlCount: number;
  checkedUrlCount: number;
  indexedUrlCount: number;
  discoveredNotIndexedCount: number;
  isComplete: boolean;
  confirmedNewlyIndexed: number;
  netIndexedChange: number | null;
}

export interface ProviderIndexingTrend {
  provider: "google" | "bing";
  days: IndexingTrendDay[];
  completeSnapshotDays: number;
  latestIndexedUrlCount: number | null;
  latestSitemapUrlCount: number | null;
  latestNetIndexedChange: number | null;
  averageNetNewPerDay: number | null;
  projectedDaysToFullIndex: number | null;
  averageCheckedPerDay: number | null;
  estimatedDaysForFullRecheck: number | null;
}

export interface IndexingTrends {
  google: ProviderIndexingTrend;
  bing: ProviderIndexingTrend;
}

const GOOGLE_PROJECTION_POSITIVE_DAYS_REQUIRED = 7;
const GOOGLE_PROJECTION_SNAPSHOTS_REQUIRED =
  GOOGLE_PROJECTION_POSITIVE_DAYS_REQUIRED + 1;

function calendarDayDifference(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) -
      Date.UTC(startYear, startMonth - 1, startDay)) /
      (24 * 60 * 60 * 1000),
  );
}

export function buildProviderIndexingTrend(
  provider: "google" | "bing",
  snapshots: Array<{
    snapshotDate: string;
    sitemapUrlCount: number;
    checkedUrlCount: number;
    indexedUrlCount: number;
    discoveredNotIndexedCount: number;
    isComplete: boolean;
  }>,
  eventCounts: Map<string, number>,
): ProviderIndexingTrend {
  const chronological = [...snapshots].sort((a, b) =>
    a.snapshotDate.localeCompare(b.snapshotDate),
  );
  const complete = chronological.filter((snapshot) => snapshot.isComplete);
  const netChangeByDate = new Map<string, number | null>();
  for (let index = 0; index < complete.length; index += 1) {
    const current = complete[index];
    const previous = complete[index - 1];
    netChangeByDate.set(
      current.snapshotDate,
      previous ? current.indexedUrlCount - previous.indexedUrlCount : null,
    );
  }

  const days = chronological.slice(-14).map((snapshot) => ({
    date: snapshot.snapshotDate,
    sitemapUrlCount: snapshot.sitemapUrlCount,
    checkedUrlCount: snapshot.checkedUrlCount,
    indexedUrlCount: snapshot.indexedUrlCount,
    discoveredNotIndexedCount: snapshot.discoveredNotIndexedCount,
    isComplete: snapshot.isComplete,
    confirmedNewlyIndexed: eventCounts.get(snapshot.snapshotDate) ?? 0,
    netIndexedChange: netChangeByDate.get(snapshot.snapshotDate) ?? null,
  }));
  const latest = chronological.at(-1) ?? null;
  const latestComplete = complete.at(-1) ?? null;
  const firstComplete = complete[0] ?? null;
  const completeSpanDays =
    firstComplete && latestComplete
      ? calendarDayDifference(firstComplete.snapshotDate, latestComplete.snapshotDate)
      : 0;
  const averageNetNewPerDay =
    firstComplete &&
    latestComplete &&
    completeSpanDays > 0
      ? (latestComplete.indexedUrlCount - firstComplete.indexedUrlCount) /
        completeSpanDays
      : null;
  // An ETA becomes meaningful only after a consecutive week of positive,
  // complete daily changes. This needs an extra complete snapshot as the
  // baseline for the first day-over-day movement.
  const googleProjectionWindow =
    provider === "google"
      ? complete.slice(-GOOGLE_PROJECTION_SNAPSHOTS_REQUIRED)
      : [];
  const hasConsecutiveGoogleSnapshots =
    googleProjectionWindow.length === GOOGLE_PROJECTION_SNAPSHOTS_REQUIRED &&
    googleProjectionWindow.every((snapshot, index) => {
      if (index === 0) return true;
      return (
        calendarDayDifference(
          googleProjectionWindow[index - 1]!.snapshotDate,
          snapshot.snapshotDate,
        ) === 1
      );
    });
  const googlePositiveDailyChanges = googleProjectionWindow
    .slice(1)
    .map(
      (snapshot, index) =>
        snapshot.indexedUrlCount -
        googleProjectionWindow[index]!.indexedUrlCount,
    );
  const hasPositiveGoogleDailyChanges =
    googlePositiveDailyChanges.length ===
      GOOGLE_PROJECTION_POSITIVE_DAYS_REQUIRED &&
    googlePositiveDailyChanges.every((change) => change > 0);
  const projectionAverageNetNewPerDay =
    hasPositiveGoogleDailyChanges
      ? googlePositiveDailyChanges.reduce((sum, change) => sum + change, 0) /
        googlePositiveDailyChanges.length
      : null;
  const projectedDaysToFullIndex =
    provider === "google" &&
    hasConsecutiveGoogleSnapshots &&
    projectionAverageNetNewPerDay !== null &&
    latestComplete
      ? Math.ceil(
          Math.max(
            0,
            latestComplete.sitemapUrlCount - latestComplete.indexedUrlCount,
          ) / projectionAverageNetNewPerDay,
        )
      : null;
  const recent = chronological.slice(-7);
  const averageCheckedPerDay =
    recent.length > 0
      ? recent.reduce((total, snapshot) => total + snapshot.checkedUrlCount, 0) /
        recent.length
      : null;
  const estimatedDaysForFullRecheck =
    provider === "bing" &&
    latest &&
    averageCheckedPerDay !== null &&
    averageCheckedPerDay > 0
      ? Math.ceil(latest.sitemapUrlCount / averageCheckedPerDay)
      : null;

  return {
    provider,
    days,
    completeSnapshotDays: complete.length,
    latestIndexedUrlCount: latestComplete?.indexedUrlCount ?? null,
    latestSitemapUrlCount: latestComplete?.sitemapUrlCount ?? null,
    latestNetIndexedChange: latestComplete
      ? netChangeByDate.get(latestComplete.snapshotDate) ?? null
      : null,
    averageNetNewPerDay,
    projectedDaysToFullIndex,
    averageCheckedPerDay,
    estimatedDaysForFullRecheck,
  };
}

export async function getIndexingTrends(): Promise<IndexingTrends> {
  const [snapshots, events] = await Promise.all([
    db
      .select({
        snapshotDate: seoCoverageDailySnapshotsTable.snapshotDate,
        provider: seoCoverageDailySnapshotsTable.provider,
        sitemapUrlCount: seoCoverageDailySnapshotsTable.sitemapUrlCount,
        checkedUrlCount: seoCoverageDailySnapshotsTable.checkedUrlCount,
        indexedUrlCount: seoCoverageDailySnapshotsTable.indexedUrlCount,
        discoveredNotIndexedCount:
          seoCoverageDailySnapshotsTable.discoveredNotIndexedCount,
        isComplete: seoCoverageDailySnapshotsTable.isComplete,
      })
      .from(seoCoverageDailySnapshotsTable)
      .orderBy(desc(seoCoverageDailySnapshotsTable.snapshotDate))
      .limit(60),
    db
      .select({
        eventDate: seoCoverageIndexEventsTable.eventDate,
        provider: seoCoverageIndexEventsTable.provider,
        count: sql<number>`count(*)::int`,
      })
      .from(seoCoverageIndexEventsTable)
      .groupBy(
        seoCoverageIndexEventsTable.eventDate,
        seoCoverageIndexEventsTable.provider,
      ),
  ]);

  const eventCounts = {
    google: new Map<string, number>(),
    bing: new Map<string, number>(),
  };
  for (const event of events) {
    if (event.provider === "google" || event.provider === "bing") {
      eventCounts[event.provider].set(event.eventDate, event.count);
    }
  }
  const providerSnapshots = {
    google: snapshots.filter((snapshot) => snapshot.provider === "google"),
    bing: snapshots.filter((snapshot) => snapshot.provider === "bing"),
  };
  return {
    google: buildProviderIndexingTrend(
      "google",
      providerSnapshots.google,
      eventCounts.google,
    ),
    bing: buildProviderIndexingTrend(
      "bing",
      providerSnapshots.bing,
      eventCounts.bing,
    ),
  };
}

function applyBucket(k: KindBuckets, bucket: string, count: number): void {
  switch (bucket) {
    case "indexed":
      k.indexed += count;
      break;
    case "discovered-not-indexed":
      k.discoveredNotIndexed += count;
      break;
    case "crawl-error":
      k.crawlError += count;
      break;
    case "soft-404":
      k.soft404 += count;
      break;
    default:
      k.unknown += count;
      break;
  }
}

/**
 * Return the most recent scan runs so the dashboard can display a history
 * table and let admins drill into any run's resubmitted URL list.
 */
async function attachRunProgress(
  runs: SeoCoverageRun[],
): Promise<SeoCoverageRunWithProgress[]> {
  return runs.map((run) => {
      if (run.finishedAt) return { ...run, progress: null };

      const lastProgressAt = run.lastProgressAt ?? run.startedAt;
      const isRunning =
        Date.now() - lastProgressAt.getTime() <= SCAN_STALL_MS;
      return {
        ...run,
        progress: {
          state: isRunning ? "running" : "stalled",
          completedUrlCount: run.completedUrlCount,
          // urlCount records the full sitemap inventory. A provider scan can
          // intentionally cap its queue, so report the actual scan target.
          totalUrlCount: Math.min(run.urlCount, maxUrls()),
          lastProgressAt: run.lastProgressAt,
        },
      };
    });
}

export async function listRecentRuns(
  limit = 20,
): Promise<SeoCoverageRunWithProgress[]> {
  const runs = await db
    .select()
    .from(seoCoverageRunsTable)
    .orderBy(desc(seoCoverageRunsTable.startedAt))
    .limit(Math.min(limit, 50));
  return attachRunProgress(runs);
}

export async function getCoverageOverview(): Promise<CoverageOverview> {
  // Fetch both Google and Bing buckets in one query so we can fall back to
  // Bing data for rows where Google returned an error or was not configured.
  const rows = await db
    .select({
      kind: seoCoverageStatusTable.artifactKind,
      googleBucket: seoCoverageStatusTable.googleBucket,
      bingBucket: seoCoverageStatusTable.bingBucket,
      count: sql<number>`count(*)::int`,
    })
    .from(seoCoverageStatusTable)
    .groupBy(
      seoCoverageStatusTable.artifactKind,
      seoCoverageStatusTable.googleBucket,
      seoCoverageStatusTable.bingBucket,
    );

  const byKind = new Map<string, KindBuckets>();
  for (const r of rows) {
    // Choose the best available coverage verdict for this group:
    // prefer Google if it returned a real coverage bucket; otherwise fall
    // back to Bing. Rows without a usable verdict are still part of the
    // sitemap inventory; they belong in the explicit pending column rather
    // than silently disappearing from the table.
    const effectiveBucket = VALID_COVERAGE_BUCKETS.has(r.googleBucket ?? "")
      ? r.googleBucket!
      : VALID_COVERAGE_BUCKETS.has(r.bingBucket ?? "")
        ? r.bingBucket!
        : null;

    const k = byKind.get(r.kind) ?? {
      kind: r.kind,
      total: 0,
      inspected: 0,
      pendingInspection: 0,
      indexed: 0,
      discoveredNotIndexed: 0,
      crawlError: 0,
      soft404: 0,
      unknown: 0,
    };
    k.total += r.count;
    if (effectiveBucket === null) {
      k.pendingInspection += r.count;
    } else {
      k.inspected += r.count;
      applyBucket(k, effectiveBucket, r.count);
    }
    byKind.set(r.kind, k);
  }

  const [[rawLastRun], indexingTrends] = await Promise.all([
    db
      .select()
      .from(seoCoverageRunsTable)
      .orderBy(desc(seoCoverageRunsTable.startedAt))
      .limit(1),
    getIndexingTrends(),
  ]);
  const [lastRun] = rawLastRun
    ? await attachRunProgress([rawLastRun])
    : [null];

  // Read provider diagnostics written by this scan only. A status row stores
  // the latest inspection, so limiting by run start prevents an old quota
  // response from masking a later credential problem (or vice versa).
  const currentProviderRows = lastRun
    ? await db
        .select({
          googleRaw: seoCoverageStatusTable.googleRaw,
          bingBucket: seoCoverageStatusTable.bingBucket,
          bingRaw: seoCoverageStatusTable.bingRaw,
        })
        .from(seoCoverageStatusTable)
        .where(gte(seoCoverageStatusTable.lastCheckedAt, lastRun.startedAt))
    : [];

  // Surface the actual API error message so the UI can explain the current
  // condition without turning a quota limitation into access advice.
  let googleLastError: string | null = null;
  let googleQuotaWarning = false;
  for (const row of currentProviderRows) {
    const raw = row.googleRaw as
      | { error?: unknown; classification?: unknown }
      | null;
    const error =
      raw && typeof raw.error === "string" ? raw.error : null;
    const isQuota =
      raw?.classification === "quota-exhausted" ||
      (error !== null && isGoogleInspectionQuotaError(error));
    if (isQuota) {
      googleQuotaWarning = true;
      googleLastError ??= error;
    } else if (error && !googleLastError) {
      googleLastError = error;
    }
  }

  // Only show access remediation for a terminal scan. Provider counters are
  // persisted at the end of a run, so an active scan legitimately reports
  // googleChecked=0 while successful URL inspections are still in flight.
  // Treating that temporary zero as an auth failure produces a false warning
  // for the entire duration of every manual scan.
  const googleAuthWarning =
    !!lastRun &&
    !!lastRun.finishedAt &&
    lastRun.googleConfigured &&
    lastRun.googleChecked === 0 &&
    lastRun.urlCount > 0 &&
    !googleQuotaWarning;

  // Bing can throttle partway through a run, and throttled URLs with a prior
  // valid verdict intentionally retain that verdict. The run-level flag is
  // therefore the only reliable source for this warning; zero successful
  // checks can also be caused by auth, timeouts, or invalid URL responses.
  const bingThrottleWarning =
    !!lastRun &&
    lastRun.bingConfigured &&
    lastRun.urlCount > 0 &&
    lastRun.bingThrottled;

  return {
    lastRun: lastRun ?? null,
    googleConfigured: googleConfigured(),
    bingConfigured: bingConfigured(),
    byKind: Array.from(byKind.values()).sort((a, b) =>
      a.kind.localeCompare(b.kind),
    ),
    indexingTrends,
    scanRunning: lastRun?.progress?.state === "running",
    googleQuotaWarning,
    googleAuthWarning,
    googleLastError,
    googleServiceAccountEmail: googleAuthWarning
      ? googleServiceAccountEmail()
      : null,
    googleSiteUrl: googleAuthWarning ? normalizedGoogleSiteUrl() || null : null,
    bingThrottleWarning,
  };
}

export interface ResubmittedUrlRow {
  url: string;
  path: string;
  artifactKind: string;
  resubmittedAt: string;
  // Current coverage status from the live seo_coverage_status table.
  // Null when the URL is no longer tracked (unpublished after resubmission).
  currentGoogleBucket: string | null;
  currentGoogleCoverageState: string | null;
  currentBingBucket: string | null;
  currentLastCheckedAt: string | null;
}

/**
 * Return the list of URLs resubmitted in a specific scan run, annotated with
 * their current index-coverage status so admins can see whether the nudge worked.
 */
export async function getRunResubmittedUrls(
  runId: string,
): Promise<ResubmittedUrlRow[]> {
  const rows = await db
    .select({
      url: seoResubmittedUrlsTable.url,
      path: seoResubmittedUrlsTable.path,
      artifactKind: seoResubmittedUrlsTable.artifactKind,
      resubmittedAt: seoResubmittedUrlsTable.resubmittedAt,
      currentGoogleBucket: seoCoverageStatusTable.googleBucket,
      currentGoogleCoverageState: seoCoverageStatusTable.googleCoverageState,
      currentBingBucket: seoCoverageStatusTable.bingBucket,
      currentLastCheckedAt: seoCoverageStatusTable.lastCheckedAt,
    })
    .from(seoResubmittedUrlsTable)
    .leftJoin(
      seoCoverageStatusTable,
      eq(seoResubmittedUrlsTable.url, seoCoverageStatusTable.url),
    )
    .where(eq(seoResubmittedUrlsTable.runId, runId))
    .orderBy(seoResubmittedUrlsTable.path);

  return rows.map((r) => ({
    url: r.url,
    path: r.path,
    artifactKind: r.artifactKind,
    resubmittedAt: r.resubmittedAt.toISOString(),
    currentGoogleBucket: r.currentGoogleBucket ?? null,
    currentGoogleCoverageState: r.currentGoogleCoverageState ?? null,
    currentBingBucket: r.currentBingBucket ?? null,
    currentLastCheckedAt: r.currentLastCheckedAt
      ? r.currentLastCheckedAt.toISOString()
      : null,
  }));
}

export interface CoverageUrlRow {
  url: string;
  path: string;
  artifactKind: string;
  googleBucket: string | null;
  googleCoverageState: string | null;
  bingBucket: string | null;
  bingHttpStatus: number | null;
  lastCheckedAt: string | null;
}

export async function listCoverageUrls(opts: {
  kind?: string;
  bucket?: string;
  limit: number;
}): Promise<CoverageUrlRow[]> {
  const conds = [];
  if (opts.kind) conds.push(eq(seoCoverageStatusTable.artifactKind, opts.kind));
  if (opts.bucket) {
    if (opts.bucket === "pending-inspection") {
      // Neither provider supplied a usable inspection result. This includes
      // Google quota responses and Bing rows skipped after throttling.
      conds.push(
        and(
          or(
            isNull(seoCoverageStatusTable.googleBucket),
            notInArray(seoCoverageStatusTable.googleBucket, [
              ...COVERAGE_BUCKET_VALUES,
            ]),
          ),
          or(
            isNull(seoCoverageStatusTable.bingBucket),
            notInArray(seoCoverageStatusTable.bingBucket, [
              ...COVERAGE_BUCKET_VALUES,
            ]),
          ),
        )!,
      );
    } else {
      conds.push(
        or(
          eq(seoCoverageStatusTable.googleBucket, opts.bucket),
          and(
            or(
              isNull(seoCoverageStatusTable.googleBucket),
              notInArray(seoCoverageStatusTable.googleBucket, [
                ...COVERAGE_BUCKET_VALUES,
              ]),
            ),
            eq(seoCoverageStatusTable.bingBucket, opts.bucket),
          ),
        )!,
      );
    }
  }
  const rows = await db
    .select({
      url: seoCoverageStatusTable.url,
      path: seoCoverageStatusTable.path,
      artifactKind: seoCoverageStatusTable.artifactKind,
      googleBucket: seoCoverageStatusTable.googleBucket,
      googleCoverageState: seoCoverageStatusTable.googleCoverageState,
      bingBucket: seoCoverageStatusTable.bingBucket,
      bingHttpStatus: seoCoverageStatusTable.bingHttpStatus,
      lastCheckedAt: seoCoverageStatusTable.lastCheckedAt,
    })
    .from(seoCoverageStatusTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(seoCoverageStatusTable.path)
    .limit(Math.min(opts.limit, 500));
  return rows.map((r) => ({
    ...r,
    lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
  }));
}

let bingProbeImpl: BingProber | null = null;

/**
 * Serialize + pace Bing probes, and stop hitting the network for the rest of
 * the queue's lifetime once a single throttle response is seen (Bing's
 * quota is per-window; every further call would just come back throttled).
 * The throttle check runs *inside* the serialized callback, immediately
 * before the network call, so probes enqueued concurrently by several
 * workers can't slip through after throttling is known.
 */
export function createBingProbeQueue(opts?: {
  probe?: BingProber;
  delayMs?: number;
}): {
  enqueue: (url: string) => Promise<BingQueueResult>;
  isThrottled: () => boolean;
} {
  const probe = opts?.probe ?? bingProbeImpl ?? probeBing;
  const delayMs = opts?.delayMs ?? bingProbeDelayMs();
  let throttled = false;
  let chain: Promise<unknown> = Promise.resolve();
  function enqueue(url: string): Promise<BingQueueResult> {
    const p = chain.then(async (): Promise<BingQueueResult> => {
      if (throttled) {
        return {
          bucket: "not-checked",
          httpStatus: null,
          lastCrawlAt: null,
          raw: { skipped: "bing-throttled" },
          throttled: true,
          skippedThrottled: true,
        };
      }
      const r = await probe(url);
      if (r.throttled) {
        throttled = true;
        return { ...r, skippedThrottled: false };
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return { ...r, skippedThrottled: false };
    });
    chain = p.catch(() => {});
    return p;
  }
  return { enqueue, isThrottled: () => throttled };
}

export function __setEntriesForTesting(
  fn: (() => Promise<string[]>) | null,
): void {
  entriesOverrideForTesting = fn;
}

export interface BingQueueResult extends BingProbe {
  // True when the probe never hit the network because an earlier request in
  // this queue already came back throttled.
  skippedThrottled: boolean;
}

export function __setBingProbeForTesting(fn: BingProber | null): void {
  bingProbeImpl = fn;
}

let entriesOverrideForTesting: (() => Promise<string[]>) | null = null;

type SubmitUrlsFn = typeof submitUrls;

export function __setSubmitUrlsForTesting(fn: SubmitUrlsFn | null): void {
  submitUrlsImpl = fn;
}

export function __setBypassAdvisoryLockForTesting(bypass: boolean): void {
  bypassAdvisoryLockForTesting = bypass;
}

let submitUrlsImpl: SubmitUrlsFn | null = null;
