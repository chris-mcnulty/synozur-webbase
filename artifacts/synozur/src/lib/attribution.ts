// #131: first-touch attribution capture.
//
// On first landing we read the UTM params + document.referrer and persist them
// to localStorage under `synozur.firstTouch.v1`. Subsequent landings refresh
// `lastTouch` but never overwrite first-touch. Form submissions read both
// records and post them with the payload so the api-server can write them
// onto the HubSpot contact's first-touch / last-touch properties.

const FIRST_TOUCH_KEY = "synozur.firstTouch.v1";
const LAST_TOUCH_KEY = "synozur.lastTouch.v1";

export interface AttributionRecord {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  landingPage: string | null;
  referrer: string | null;
  capturedAt: string;
}

function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const v = new URL(window.location.href).searchParams.get(name);
  return v && v.length > 0 ? v.slice(0, 200) : null;
}

function snapshotCurrent(): AttributionRecord {
  return {
    utmSource: readQueryParam("utm_source"),
    utmMedium: readQueryParam("utm_medium"),
    utmCampaign: readQueryParam("utm_campaign"),
    utmTerm: readQueryParam("utm_term"),
    utmContent: readQueryParam("utm_content"),
    landingPage:
      typeof window !== "undefined" ? window.location.href.slice(0, 2048) : null,
    referrer:
      typeof document !== "undefined" && document.referrer
        ? document.referrer.slice(0, 2048)
        : null,
    capturedAt: new Date().toISOString(),
  };
}

function readStored(key: string): AttributionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AttributionRecord;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(key: string, record: AttributionRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // ignore — localStorage may be disabled
  }
}

export function captureAttributionOnLoad(): void {
  if (typeof window === "undefined") return;
  const current = snapshotCurrent();
  // Only persist a "real" touch — i.e. one with at least one UTM param or a
  // non-self referrer. Otherwise every internal navigation would overwrite
  // last-touch with empty values.
  const hasSignal =
    current.utmSource !== null ||
    current.utmMedium !== null ||
    current.utmCampaign !== null ||
    (current.referrer !== null && !sameOriginReferrer(current.referrer));
  if (!readStored(FIRST_TOUCH_KEY)) {
    writeStored(FIRST_TOUCH_KEY, current);
  }
  if (hasSignal) writeStored(LAST_TOUCH_KEY, current);
}

function sameOriginReferrer(referrer: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const u = new URL(referrer);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

export interface AttributionPayload {
  marketingOptIn?: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  landingPage?: string;
  referrer?: string;
}

export function attributionPayload(): AttributionPayload {
  // Prefer first-touch values; fall back to last-touch where first-touch is
  // empty. This matches HubSpot's first-touch / last-touch dual semantics.
  const first = readStored(FIRST_TOUCH_KEY);
  const last = readStored(LAST_TOUCH_KEY);
  const pick = (k: keyof AttributionRecord): string | undefined => {
    const a = first?.[k];
    const b = last?.[k];
    if (typeof a === "string" && a.length > 0) return a;
    if (typeof b === "string" && b.length > 0) return b;
    return undefined;
  };
  const out: AttributionPayload = {};
  const s = pick("utmSource"); if (s) out.utmSource = s;
  const m = pick("utmMedium"); if (m) out.utmMedium = m;
  const c = pick("utmCampaign"); if (c) out.utmCampaign = c;
  const t = pick("utmTerm"); if (t) out.utmTerm = t;
  const ct = pick("utmContent"); if (ct) out.utmContent = ct;
  const lp = pick("landingPage"); if (lp) out.landingPage = lp;
  const r = pick("referrer"); if (r) out.referrer = r;
  return out;
}
