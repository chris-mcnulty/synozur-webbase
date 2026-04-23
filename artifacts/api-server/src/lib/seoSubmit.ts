import { createHash } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { logger } from "./logger";

// #SEO: search-engine URL submission.
//
// Google retired the public sitemap-ping endpoint in 2023, so the only
// authoritative push channels today are:
//   1. IndexNow (Bing, Yandex, Seznam, Naver, Yep) — single POST with a
//      self-hosted key file at /<key>.txt.
//   2. Google Indexing API — requires a service-account JSON with the
//      Search Console property verified. Officially scoped to JobPosting
//      and BroadcastEvent schemas, but in practice accepted for all URLs
//      and surfaces in Search Console's "URL Inspection" freshness.
//   3. Bing Webmaster Tools SubmitUrlBatch — requires an API key.
//
// Every path is opt-in via env vars so the handler stays safe to expose
// without configuration.

export const INDEXNOW_HOSTS = [
  "api.indexnow.org",
  "www.bing.com",
  "yandex.com",
];

export interface SubmitResult {
  target: string;
  ok: boolean;
  status?: number;
  submitted: number;
  error?: string;
}

export interface SubmitBundle {
  origin: string;
  urls: string[];
  results: SubmitResult[];
}

function indexNowKey(): string | null {
  const raw = process.env.INDEXNOW_KEY?.trim();
  if (!raw) return null;
  // IndexNow keys must be 8–128 hex chars. If the env var is a secret string
  // we hash it to conform; otherwise we pass it through verbatim.
  if (/^[a-f0-9]{8,128}$/i.test(raw)) return raw.toLowerCase();
  return createHash("sha256").update(raw).digest("hex");
}

/** Derive the public key-validation filename served at the site root. */
export function indexNowKeyFileName(): string | null {
  const key = indexNowKey();
  return key ? `${key}.txt` : null;
}

/** Return the IndexNow key if the request path matches the expected file. */
export function matchIndexNowKeyPath(pathname: string): string | null {
  const key = indexNowKey();
  if (!key) return null;
  const expected = `/${key}.txt`;
  return pathname === expected ? key : null;
}

async function submitIndexNow(
  origin: string,
  urls: string[],
): Promise<SubmitResult> {
  const key = indexNowKey();
  if (!key) {
    return { target: "indexnow", ok: false, submitted: 0, error: "INDEXNOW_KEY not set" };
  }
  try {
    const host = new URL(origin).host;
    const body = {
      host,
      key,
      keyLocation: `${origin}/${key}.txt`,
      urlList: urls,
    };
    const res = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    return {
      target: "indexnow",
      ok: res.ok,
      status: res.status,
      submitted: urls.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { target: "indexnow", ok: false, submitted: 0, error: msg };
  }
}

/** Maximum number of concurrent requests to the Google Indexing API. */
const GOOGLE_INDEXING_CONCURRENCY = 5;

/**
 * Submit `urls` to the Google Indexing API with bounded concurrency.
 * Returns the number of successfully submitted URLs.
 */
async function submitGoogleIndexingWithConcurrency(
  client: Awaited<ReturnType<GoogleAuth["getClient"]>>,
  urls: string[],
): Promise<number> {
  let ok = 0;
  const queue = [...urls];
  async function worker() {
    for (;;) {
      const u = queue.shift();
      if (!u) return;
      try {
        await client.request({
          url: "https://indexing.googleapis.com/v3/urlNotifications:publish",
          method: "POST",
          data: { url: u, type: "URL_UPDATED" },
        });
        ok += 1;
      } catch {
        // Individual URL failed; continue with the remaining queue.
      }
    }
  }
  const workerCount = Math.min(GOOGLE_INDEXING_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return ok;
}

async function submitGoogleIndexing(urls: string[]): Promise<SubmitResult> {
  const sa = process.env.GOOGLE_INDEXING_SA_JSON?.trim();
  if (!sa) {
    return {
      target: "google-indexing",
      ok: false,
      submitted: 0,
      error: "GOOGLE_INDEXING_SA_JSON not set",
    };
  }
  let credentials: unknown;
  try {
    credentials = JSON.parse(sa);
  } catch {
    return {
      target: "google-indexing",
      ok: false,
      submitted: 0,
      error: "GOOGLE_INDEXING_SA_JSON is not valid JSON",
    };
  }
  try {
    const auth = new GoogleAuth({
      credentials: credentials as ConstructorParameters<typeof GoogleAuth>[0]["credentials"],
      scopes: ["https://www.googleapis.com/auth/indexing"],
    });
    const client = await auth.getClient();
    const ok = await submitGoogleIndexingWithConcurrency(client, urls);
    return {
      target: "google-indexing",
      ok: ok === urls.length,
      submitted: ok,
      status: ok === urls.length ? 200 : 207,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { target: "google-indexing", ok: false, submitted: 0, error: msg };
  }
}

async function submitBing(urls: string[]): Promise<SubmitResult> {
  const apiKey = process.env.BING_API_KEY?.trim();
  const siteUrl = process.env.BING_SITE_URL?.trim();
  if (!apiKey || !siteUrl) {
    return {
      target: "bing-webmaster",
      ok: false,
      submitted: 0,
      error: "BING_API_KEY or BING_SITE_URL not set",
    };
  }
  try {
    const res = await fetch(
      `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ siteUrl, urlList: urls }),
      },
    );
    return {
      target: "bing-webmaster",
      ok: res.ok,
      status: res.status,
      submitted: res.ok ? urls.length : 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { target: "bing-webmaster", ok: false, submitted: 0, error: msg };
  }
}

/**
 * Submit a batch of absolute URLs to every configured search-engine channel.
 * Channels without credentials report ok:false with an explanatory error but
 * never throw, so callers can surface the full per-target status.
 */
export async function submitUrls(
  origin: string,
  urls: string[],
): Promise<SubmitBundle> {
  const unique = Array.from(new Set(urls.filter((u) => /^https?:\/\//i.test(u))));
  if (unique.length === 0) {
    return { origin, urls: [], results: [] };
  }
  const results = await Promise.all([
    submitIndexNow(origin, unique),
    submitGoogleIndexing(unique),
    submitBing(unique),
  ]);
  for (const r of results) {
    if (!r.ok) {
      logger.info({ target: r.target, err: r.error }, "seo.submit channel skipped");
    } else {
      logger.info({ target: r.target, submitted: r.submitted }, "seo.submit channel ok");
    }
  }
  return { origin, urls: unique, results };
}
