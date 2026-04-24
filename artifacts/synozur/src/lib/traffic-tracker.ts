/**
 * First-party traffic tracker. Fires a POST to /api/traffic/collect on every
 * SPA route change, and patches in time-on-page + scroll depth via a sendBeacon
 * on pagehide/unload.
 *
 * First-party by design: no third-party JS, no cookies. Session identity is
 * derived server-side from IP + UA + UTC day. Skips admin routes.
 */

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const COLLECT_URL = `${BASE_PATH}/api/traffic/collect`;
const EVENT_URL = `${BASE_PATH}/api/traffic/event`;

interface PendingPageview {
  pageviewId: string;
  path: string;
  startedAt: number;
  maxScrollPct: number;
}

let pending: PendingPageview | null = null;
let lastTrackedPath: string | null = null;

function maxScrollSoFar(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop || 0;
  const viewport = window.innerHeight || doc.clientHeight || 0;
  const scrollable = Math.max(1, (doc.scrollHeight || 0) - viewport);
  const pct = Math.round(((scrollTop + viewport) / (doc.scrollHeight || 1)) * 100);
  return Math.max(0, Math.min(100, isFinite(pct) ? pct : Math.round((scrollTop / scrollable) * 100)));
}

function shouldSkip(path: string): boolean {
  // Don't track admin telemetry — admins looking at their own dashboards
  // would pollute the numbers.
  if (path.startsWith("/admin")) return true;
  if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) return true;
  return false;
}

async function post(url: string, body: Record<string, unknown>): Promise<{ pageviewId: string | null } | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { pageviewId?: string | null } | null;
    return { pageviewId: json?.pageviewId ?? null };
  } catch {
    return null;
  }
}

function sendBeacon(body: Record<string, unknown>): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
      navigator.sendBeacon(COLLECT_URL, blob);
      return;
    }
  } catch {
    // fall through to fetch
  }
  void post(COLLECT_URL, body);
}

function finalizePending(): void {
  if (!pending) return;
  const timeOnPageMs = Math.max(0, Date.now() - pending.startedAt);
  const scroll = Math.max(pending.maxScrollPct, maxScrollSoFar());
  sendBeacon({
    path: pending.path,
    pageviewId: pending.pageviewId,
    timeOnPageMs,
    scrollDepthPct: scroll,
  });
  pending = null;
}

/**
 * Build a UTM payload from the current URL's querystring. Empty/absent
 * params are returned as null so the server can trim to null consistently.
 */
function readUtms(): Record<string, string | null> {
  if (typeof window === "undefined") {
    return {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    };
  }
  const q = new URLSearchParams(window.location.search);
  const take = (k: string) => {
    const v = q.get(k);
    return v ? v.slice(0, 120) : null;
  };
  return {
    utmSource: take("utm_source"),
    utmMedium: take("utm_medium"),
    utmCampaign: take("utm_campaign"),
    utmTerm: take("utm_term"),
    utmContent: take("utm_content"),
  };
}

export async function trackPageview(path: string, title?: string | null): Promise<void> {
  if (typeof window === "undefined") return;
  if (shouldSkip(path)) {
    finalizePending();
    lastTrackedPath = null;
    return;
  }
  // De-dupe: wouter sometimes re-fires useEffect on first mount.
  if (path === lastTrackedPath) return;
  lastTrackedPath = path;

  finalizePending();

  // Include the current querystring so the server can harvest UTM params for
  // first-touch attribution on the session row.
  const search = window.location.search || "";
  const pathWithQuery = `${path}${search}`;

  const body: Record<string, unknown> = {
    path: pathWithQuery,
    title: title ?? document.title ?? null,
    referrer: document.referrer || null,
    ...readUtms(),
  };
  const result = await post(COLLECT_URL, body);
  if (result?.pageviewId) {
    pending = {
      pageviewId: result.pageviewId,
      path,
      startedAt: Date.now(),
      maxScrollPct: 0,
    };
  }
}

/**
 * Record a named custom event (e.g. "contact-form-submit",
 * "workshop-cta-click", "resource-download"). Fires fire-and-forget; failures
 * are swallowed so the caller's UI path is never blocked.
 */
export async function trackEvent(
  name: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (typeof window === "undefined") return;
  const path = window.location.pathname || "/";
  if (shouldSkip(path)) return;
  await post(EVENT_URL, {
    eventName: name,
    path,
    properties: properties ?? null,
  });
}

let installed = false;

export function installTrafficTracker(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const onScroll = () => {
    if (!pending) return;
    const pct = maxScrollSoFar();
    if (pct > pending.maxScrollPct) pending.maxScrollPct = pct;
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  const onHide = () => finalizePending();
  window.addEventListener("pagehide", onHide);
  // Some browsers (notably iOS Safari) don't reliably fire pagehide on tab
  // switch; visibilitychange → hidden is a usable fallback.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") finalizePending();
  });
}
