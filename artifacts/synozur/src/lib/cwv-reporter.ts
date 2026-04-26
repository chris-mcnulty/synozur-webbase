/**
 * #142 Phase B — Real-user Core Web Vitals reporter.
 *
 * Hooks the `web-vitals` SDK and posts each metric to
 * `POST /api/metrics/cwv`. Initialization is idempotent so the consent
 * effect in `analytics.tsx` can call us each time it re-runs without
 * double-attaching listeners.
 *
 * Transport: prefer `navigator.sendBeacon` so reports survive the
 * pagehide/unload during which web-vitals fires terminal metrics. Fall
 * back to a fire-and-forget `fetch(... keepalive: true)` when sendBeacon
 * isn't available.
 *
 * Out of scope for v0:
 *   - Route normalization (slugs → templates). The pathname is sent as
 *     observed; the admin dashboard groups by raw route. A follow-up
 *     can ship a small `normalizeRoute(pathname)` that maps known
 *     prefixes to template paths.
 *   - Sampling: web-vitals already fires once per metric per page
 *     session; volume scales with pageviews, which is the right shape.
 */
import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type Metric,
} from "web-vitals";

let initialized = false;

const BASE_PATH = (
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : "/"
).replace(/\/$/, "");

const ENDPOINT = `${BASE_PATH}/api/metrics/cwv`;

interface CwvPayload {
  route: string;
  metric: Metric["name"];
  value: number;
  rating: Metric["rating"];
  navigationType: Metric["navigationType"] | null;
  metricId: string | null;
}

function send(payload: CwvPayload): void {
  // Best-effort. Failures are silent — performance telemetry must never
  // surface as a visitor-facing error.
  try {
    const body = JSON.stringify(payload);
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // ignore
  }
}

function reporter(metric: Metric): void {
  // Pathname only — host and querystring are intentionally dropped so
  // the server never receives anything that could leak PII through
  // request parameters.
  const route =
    typeof window !== "undefined" && window.location
      ? window.location.pathname || "/"
      : "/";
  send({
    route,
    metric: metric.name,
    value: metric.value,
    rating: metric.rating,
    navigationType: metric.navigationType ?? null,
    metricId: metric.id ?? null,
  });
}

export function initCwvReporting(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;
  onLCP(reporter);
  onINP(reporter);
  onCLS(reporter);
  onFCP(reporter);
  onTTFB(reporter);
}
