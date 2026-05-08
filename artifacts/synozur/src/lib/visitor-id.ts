// Stable per-browser visitor identifier used for deterministic A/B
// bucketing. Generated on first read; persisted in localStorage.
//
// Not PII — just a random UUID — so it's created regardless of cookie
// consent. The traffic tracker attaches it to every event so reporting
// can distinguish visitors without relying on session-derived hashes.

const KEY = "syn_vid";

function safeGetStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // localStorage may throw on access in private browsing mode under
    // some Safari versions. Fall back to sessionStorage; if both fail
    // we generate a fresh ID per call (acceptable: the visitor still
    // gets *some* assignment, just inconsistent across reloads).
    const probe = "__syn_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
}

function generate(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Last-ditch fallback (older browsers): timestamp + random.
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

let cached: string | null = null;

export function getVisitorId(): string {
  if (cached) return cached;
  const storage = safeGetStorage();
  if (!storage) {
    cached = generate();
    return cached;
  }
  const existing = storage.getItem(KEY);
  if (existing && existing.length > 0) {
    cached = existing;
    return cached;
  }
  const fresh = generate();
  try {
    storage.setItem(KEY, fresh);
  } catch {
    // ignore — caching the in-memory value is good enough for the page lifetime
  }
  cached = fresh;
  return cached;
}
