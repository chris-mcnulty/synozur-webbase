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

**July 2026 correction:** until the www-cutover republish, `server.mjs` had
NEVER run in production — the synozur artifact.toml still said
`serve = "static"` (restored April 2026 to fix an old deploy error, before
server.mjs was written in June). Prod therefore served the raw SPA shell to
every bot on synozur-owned paths. Fixed by switching the artifact's production
config to `node artifacts/synozur/server.mjs` (PORT=20131, API_PORT=8080,
health check on `/`). **Coupling:** `API_PORT` must track the api-server's
prod port in lockstep — a mismatch fails silently (bots just get the generic
static-shell fallback, no error). After any republish, smoke-test with a bot
UA against `/sprint` on the live domain, not just `/api/og`.
