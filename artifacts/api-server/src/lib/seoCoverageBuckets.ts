// #160 — pure index-coverage bucket normalizers.
//
// Kept free of any DB / network imports so the mapping logic — the only
// part the dashboard's correctness hinges on — can be unit-tested without
// a database or live search-engine credentials. seoCoverage.ts re-exports
// everything here.

export type CoverageBucket =
  | "indexed"
  | "discovered-not-indexed"
  | "crawl-error"
  | "soft-404"
  | "unknown"
  | "not-configured"
  | "error";

export interface GoogleIndexStatusResult {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  pageFetchState?: string;
  lastCrawlTime?: string;
}

/**
 * Map a Search Console `indexStatusResult` onto a coverage bucket. Pure so it
 * can be pinned by unit tests without a live Google client.
 */
export function normalizeGoogleBucket(
  r: GoogleIndexStatusResult | null | undefined,
): CoverageBucket {
  if (!r) return "unknown";
  const cs = (r.coverageState ?? "").toLowerCase();
  const fetchState = r.pageFetchState ?? "";
  const robots = r.robotsTxtState ?? "";

  if (fetchState === "SOFT_404" || cs.includes("soft 404")) return "soft-404";
  if (cs.includes("not indexed")) return "discovered-not-indexed";
  if (cs.includes("indexed")) return "indexed";
  if (robots === "DISALLOWED") return "crawl-error";
  if (
    fetchState &&
    fetchState !== "SUCCESSFUL" &&
    fetchState !== "PAGE_FETCH_STATE_UNSPECIFIED"
  ) {
    return "crawl-error";
  }
  if (r.verdict === "PASS" && cs.includes("indexed")) return "indexed";
  return "unknown";
}

export interface BingUrlInfo {
  HttpStatus?: number;
  LastCrawledDate?: string | null;
  DiscoveredDate?: string | null;
  DocumentSize?: number;
  IsPage?: boolean;
}

/** Parse a Microsoft JSON date (`/Date(1700000000000)/`) into a Date. */
export function parseMicrosoftDate(
  raw: string | null | undefined,
): Date | null {
  if (!raw) return null;
  const m = /\/Date\((-?\d+)/.exec(raw);
  if (!m) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ms = Number(m[1]);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Map a Bing GetUrlInfo `d` payload onto a coverage bucket. Pure. */
export function normalizeBingBucket(
  d: BingUrlInfo | null | undefined,
): CoverageBucket {
  if (!d) return "unknown";
  const status = typeof d.HttpStatus === "number" ? d.HttpStatus : null;
  if (status !== null && status >= 400) return "crawl-error";
  const crawled = parseMicrosoftDate(d.LastCrawledDate);
  if (status === 200 && crawled) return "indexed";
  if (d.DiscoveredDate && !crawled) return "discovered-not-indexed";
  if (crawled) return "indexed";
  return "unknown";
}
