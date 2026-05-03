/**
 * Service worker for The Synozur Alliance public site.
 *
 * Goals (task #246):
 *  - Pre-cache the SPA shell + critical brand assets so repeat visits paint
 *    instantly and a brief loss of connectivity does not break navigation.
 *  - Serve a friendly offline fallback page for navigations when the network
 *    is unavailable.
 *  - Use a versioned cache name so each deploy invalidates the previous
 *    cache cleanly — preventing the "stuck on old version" bug.
 *
 * Strategy:
 *  - Navigation requests: network-first. On network failure, serve the
 *    cached `/offline.html` page. We deliberately do NOT fall back to a
 *    cached SPA shell here because users would then see a half-working app
 *    that can't load route data; the explicit offline page is clearer.
 *  - Same-origin static assets (JS, CSS, fonts, images): cache-first with
 *    background revalidation (stale-while-revalidate) so the SPA boots
 *    instantly and works offline once installed.
 *  - Cross-origin requests (Google Fonts, analytics, YouTube, etc.) are NOT
 *    intercepted — we let the browser handle them so we never accidentally
 *    cache opaque third-party responses or break tracking.
 *
 * The hashed JS/CSS bundle filenames change every build, so they are
 * injected into `BUILD_PRECACHE_URLS` by `scripts/inject-sw-precache.mjs`
 * as a postbuild step. In dev, the placeholder remains an empty array.
 */

// Bumping this string is what invalidates old caches on a new deploy.
// The postbuild script also appends the build's content hash so each deploy
// gets a unique cache name even if we forget to bump this.
const CACHE_VERSION = "synozur-v1";
const CACHE_NAME = `synozur-shell-${CACHE_VERSION}-__BUILD_ID__`;
const OFFLINE_URL = "/offline.html";

// Static, hand-picked shell + brand assets. Hashed JS/CSS bundles are
// appended via BUILD_PRECACHE_URLS below.
const STATIC_PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/images/hero-bg.png",
  "/images/synozur-mark-color.png",
  "/images/sa-logo-horizontal-white.png",
  "/fonts/AvenirNextLTPro-Regular.ttf",
  "/fonts/AvenirNextLTPro-Demi.ttf",
  "/fonts/AvenirNextLTPro-Bold.ttf",
];

// __BUILD_PRECACHE_URLS__ — replaced by scripts/inject-sw-precache.mjs.
const BUILD_PRECACHE_URLS = /* __BUILD_PRECACHE_URLS_START__ */ [] /* __BUILD_PRECACHE_URLS_END__ */;

const PRECACHE_URLS = [...STATIC_PRECACHE_URLS, ...BUILD_PRECACHE_URLS];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Use individual adds so a single 404 doesn't abort the whole install.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            // Asset may have been removed; ignore so install still succeeds.
          }),
        ),
      );
      // Activate immediately so the new SW takes over on next navigation.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("synozur-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      // Enable navigation preload where supported for faster first paint.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Non-fatal.
        }
      }
      await self.clients.claim();
    })(),
  );
});

// Allow the page to trigger an immediate update by posting { type: "SKIP_WAITING" }.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET; let everything else go to the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Don't intercept cross-origin requests (fonts.googleapis.com, GA, YouTube,
  // Cloudflare Turnstile, etc.). They may return opaque responses we don't
  // want to cache, and intercepting them could break tracking or embeds.
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls — they must always hit the network so we don't
  // serve stale content (RSS, OG, insights data, auth, etc.). The same goes
  // for OAuth flows and well-known endpoints, which are proxied to the API
  // server and must never be cached or short-circuited by the SW.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/oauth/") ||
    url.pathname.startsWith("/.well-known/")
  ) {
    return;
  }

  // Don't cache the service worker file itself.
  if (url.pathname === "/sw.js") return;

  if (isNavigationRequest(request)) {
    event.respondWith(handleNavigation(event));
    return;
  }

  event.respondWith(handleAsset(request));
});

async function handleNavigation(event) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // Prefer the navigation-preload response if available; otherwise fetch.
    const preload = await event.preloadResponse;
    const networkResponse = preload || (await fetch(event.request));
    return networkResponse;
  } catch {
    // Network failed — show the dedicated offline page so users see a
    // clear "you're offline" message instead of a half-rendered SPA.
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("You are offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      // Only cache successful, basic (same-origin, non-opaque) responses.
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Stale-while-revalidate: return cache immediately, refresh in background.
    networkFetch.catch(() => {});
    return cached;
  }
  const network = await networkFetch;
  if (network) return network;
  // No cache, no network.
  return new Response("", { status: 504, statusText: "Offline" });
}
