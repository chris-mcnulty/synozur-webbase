---
name: Bot prerender routing (dev vs prod)
description: Why bot-prerendered HTML for some public paths can only be verified via /api/seo/page in dev, not by fetching the path itself.
---

# Bot prerendering: which paths render where

Public Synozur pages serve content-rich HTML to non-JS fetchers (AI agents,
search crawlers, curl/python-requests) via the api-server `agentRenderer`
(`buildAgentPageHtml`) exposed at `GET /api/seo/page?path=`. Social bots still
get OG-only HTML via `/api/og`.

There are **two** delivery paths and they do not cover the same URLs in dev:

- **api-server-owned content paths** (listed in
  `artifacts/api-server/.replit-artifact/artifact.toml` — e.g. `/insights`,
  `/team`, `/solutions`, `/services`, `/white-papers`, `/library`, ...) route
  straight to api-server, where `socialBotRenderer` middleware bot-renders them.
  These work in **both dev and prod**.
- **synozur-owned paths** — the SPA owns only `"/"`, which means home, `/faq`,
  `/events`, `/about`, etc. In **dev** synozur runs `vite --host`, so
  `server.mjs` is NOT exercised and these paths return the Vite SPA shell to
  *every* UA (bots included). Only in **production** does `server.mjs` (the edge)
  detect bots and proxy them to `/api/seo/page`.

**Why this matters:** a curl with a bot UA against `/faq` in dev returns the SPA
shell — that is expected, not a bug. To verify the renderer for synozur-owned
paths in dev, hit `/api/seo/page?path=/faq` directly (the same endpoint
`server.mjs` proxies to in prod).

**How to apply:** when verifying bot prerendering, check api-server-owned paths
by fetching the path with a bot UA, but check synozur-owned paths via
`/api/seo/page?path=...`. `server.mjs` `fetchAgentHtml`/`fetchOgHtml` reject on
non-2xx or non-`text/html` upstream responses so a JSON error falls back to the
static shell rather than being served as HTML.

**Hub-listing gap (durable rule):** `agentRenderer`'s slug-less `switch` in
`renderMainContent` must have a list builder for **every** DB-backed hub/listing
route. Any hub missing a `case` falls through to the generic fallback body
(`og.title` + `og.description` only), so bots see a near-empty page even though
the individual detail pages render fine.
**Why:** after the July 2026 Wix→new-site cutover, a competitor-intel diff crawler
(Orbit) read the hollow `/case-studies` and `/solutions` hubs as "AI content /
case studies / methodologies removed" and reported a strategic pivot. The content
was never gone — only the hub prerenders were empty. (Two causes stacked: a
domain migration makes diff crawlers report the wholesale URL/template change as a
pivot regardless — that self-corrects on re-crawl — plus the real hollow-hub bug.)
**How to apply:** when adding a new listing route, add both its slug-less hub
builder AND keep its visibility filters identical to `routes/seo.ts`
`collectEntries()` so hub content matches the sitemap. Verify in dev via
`/api/seo/page?path=/<hub>`. List builders intentionally cap rows (insights 50,
others 100) — a bounded bot payload is accepted and not required to match the
uncapped sitemap exactly.

**July 2026 correction:** `server.mjs` never ran in production — the `react-vite`
integratedSkill on the synozur artifact forces static serving and the platform
API blocks removing it. The fix for the Sprint funnel paths was different:
add `/sprint`, `/proof`, `/fit`, `/book` to the **api-server's** `artifact.toml`
paths list. The existing `socialBotRendererMiddleware` + `spaFallbackMiddleware`
stack already handles them correctly with zero new route code — social bots get
bespoke OG HTML, AI agents get `buildAgentPageHtml`, normal users get SPA
`index.html`. **Pattern for future synozur-owned paths that need bot prerender:**
add the path to api-server `artifact.toml` paths; the middleware chain does the
rest as long as `ogResolver.ts` has a `STATIC_PAGE_OG` entry for that path.
