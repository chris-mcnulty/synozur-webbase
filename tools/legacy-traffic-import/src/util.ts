import crypto from "node:crypto";
import fs from "node:fs";

/** Stable hash of an IP, matching the convention used in
 *  artifacts/api-server/src/lib/traffic.ts (unsalted sha256, first 32 hex). */
export function ipHash(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/** sha256 hash of a file, used as the dedupe key on legacy_traffic_batches. */
export function fileSha256(path: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(path));
  return h.digest("hex");
}

/** Per-row session key. Combining (sourceSystem, date, hour, ip, ua, country,
 *  visitor type) is enough to collapse rows that Wix's export emits as
 *  separate session attributions for the same visitor on the same hour.
 *  sourceSystem is included in the hash payload as a defense-in-depth
 *  namespace; the DB also enforces composite uniqueness on
 *  (source_system, legacy_session_key). */
export function legacySessionKey(parts: {
  sourceSystem: string;
  date: string;
  hour: number | null;
  ip: string;
  userAgent: string;
  country: string;
  visitorType: string;
}): string {
  const payload = [
    parts.sourceSystem,
    parts.date,
    parts.hour ?? "?",
    parts.ip,
    parts.userAgent,
    parts.country,
    parts.visitorType,
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 48);
}

/** Parse "3m, 12s" / "1m, 55s" / "" → milliseconds (or null). */
export function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "_") return null;
  let total = 0;
  let matched = false;
  const h = trimmed.match(/(\d+)\s*h/);
  if (h) {
    total += Number(h[1]) * 3600;
    matched = true;
  }
  const m = trimmed.match(/(\d+)\s*m\b/);
  if (m) {
    total += Number(m[1]) * 60;
    matched = true;
  }
  const s = trimmed.match(/(\d+)\s*s/);
  if (s) {
    total += Number(s[1]);
    matched = true;
  }
  if (!matched) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    total = n;
  }
  return total > 0 ? total * 1000 : 0;
}

/** Parse "100%" / "0%" / "" → 0..100 integer or null. */
export function parsePercent(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/%$/, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Parse "3/20/2026" or "2026-03-20" → ISO date "YYYY-MM-DD". */
export function parseDate(value: string): string | null {
  if (!value) return null;
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const [, mm, dd, yyyy] = usMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

/** Combine an ISO date "YYYY-MM-DD" and an hour 0..23 into a UTC Date.
 *  We anchor to UTC because Wix's hour column is unlabeled — putting both
 *  the live tracker and the legacy importer on UTC avoids a ±1 day shift in
 *  per-day reporting depending on the viewer's timezone. */
export function toUtcDate(isoDate: string, hour: number | null): Date {
  const base = new Date(`${isoDate}T00:00:00.000Z`);
  if (hour != null) base.setUTCHours(hour, 0, 0, 0);
  return base;
}

/** Normalize a path: lowercase, strip trailing slash, drop query/hash. */
export function normalizePath(raw: string | null | undefined): string {
  if (!raw) return "/";
  let s = String(raw).trim();
  if (!s) return "/";
  // Strip query/hash if a full URL leaked in.
  s = s.split("#")[0]!.split("?")[0]!;
  // Wix exports usually start with "/", but defensively handle full URLs.
  if (/^https?:/i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      // fall through with the raw string
    }
  }
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.toLowerCase();
  if (s.length > 1 && s.endsWith("/")) s = s.replace(/\/+$/, "");
  return s || "/";
}

/** Coerce Wix sentinels ("Unknown", "_", "") into null. */
export function nullable(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t || t === "_" || t.toLowerCase() === "unknown") return null;
  return t;
}

/** Best-effort device-type bucket from the Wix "Device type" column. */
export function deviceTypeFromWix(
  value: string | null | undefined,
): "desktop" | "mobile" | "tablet" | "bot" {
  const v = (value ?? "").toLowerCase();
  if (v === "tablet") return "tablet";
  if (v === "mobile") return "mobile";
  if (v === "bot" || v === "crawler") return "bot";
  return "desktop";
}

const TRAFFIC_SOURCE_MAP: Record<
  string,
  "direct" | "organic" | "ai" | "referral" | "social" | "paid" | "internal"
> = {
  direct: "direct",
  "organic search": "organic",
  "organic social": "social",
  social: "social",
  "ai platforms": "ai",
  ai: "ai",
  email: "referral",
  "email marketing": "referral",
  newsletter: "referral",
  referral: "referral",
  "google ads with wix": "paid",
  "paid search": "paid",
  "paid social": "paid",
  paid: "paid",
  internal: "internal",
};

const AI_SOURCE_HINTS = [
  "perplexity",
  "openai",
  "chatgpt",
  "chat.openai",
  "claude",
  "anthropic",
  "gemini",
  "bard",
  "copilot.microsoft",
  "you.com",
  "poe.com",
];

export function classifyTrafficSource(input: {
  trafficCategory: string | null;
  trafficSource: string | null;
  trafficSourceUrl: string | null;
  utmSource: string | null;
}): "direct" | "organic" | "ai" | "referral" | "social" | "paid" | "internal" {
  const cat = (input.trafficCategory ?? "").toLowerCase().trim();
  const src = (input.trafficSource ?? "").toLowerCase().trim();
  const ref = (input.trafficSourceUrl ?? "").toLowerCase();
  const utm = (input.utmSource ?? "").toLowerCase();

  // Promote anything obviously AI to the 'ai' bucket regardless of how Wix
  // categorized it (Wix sometimes labels Perplexity as Direct + utm_source).
  if (AI_SOURCE_HINTS.some((h) => ref.includes(h) || src.includes(h) || utm.includes(h))) {
    return "ai";
  }
  if (cat in TRAFFIC_SOURCE_MAP) return TRAFFIC_SOURCE_MAP[cat]!;
  if (src in TRAFFIC_SOURCE_MAP) return TRAFFIC_SOURCE_MAP[src]!;
  return "referral";
}

/** Pull a hostname from a URL safely. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Two-letter country code. Wix gives full names; we keep the code lowercase
 *  here only for matching and uppercase it before persisting. */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "united states": "US",
  "united kingdom": "GB",
  canada: "CA",
  australia: "AU",
  germany: "DE",
  france: "FR",
  spain: "ES",
  italy: "IT",
  netherlands: "NL",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  ireland: "IE",
  india: "IN",
  japan: "JP",
  china: "CN",
  brazil: "BR",
  mexico: "MX",
  poland: "PL",
  switzerland: "CH",
  belgium: "BE",
  austria: "AT",
  portugal: "PT",
  singapore: "SG",
  "south korea": "KR",
  "new zealand": "NZ",
  "south africa": "ZA",
};

export function countryCode(name: string | null): string | null {
  if (!name) return null;
  const code = COUNTRY_NAME_TO_CODE[name.toLowerCase()];
  if (code) return code;
  if (name.length === 2) return name.toUpperCase();
  return null;
}
