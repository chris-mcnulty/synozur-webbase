# Synozur WebBase — Admin Guide

> **Audience**: Platform administrators and senior editors who manage the Synozur Alliance website via the CMS admin UI and/or direct system access.
>
> **Maintenance**: See the [Keeping this document updated](#keeping-this-document-updated) section at the bottom. Agents working on this codebase are expected to update relevant sections whenever they add or remove functionality.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Accessing the Admin UI](#accessing-the-admin-ui)
3. [Authentication & Roles](#authentication--roles)
4. [Admin Navigation Map](#admin-navigation-map)
5. [Content Management](#content-management)
6. [Library & Collateral](#library--collateral)
7. [People, Events & Bookings](#people-events--bookings)
8. [Marketing & SEO](#marketing--seo)
9. [Traffic & Analytics](#traffic--analytics)
10. [Access Control](#access-control)
11. [Site Configuration](#site-configuration)
12. [AI Grounding](#ai-grounding)
13. [Integrations](#integrations)
14. [Asset & Media Storage](#asset--media-storage)
15. [Database & Scripts](#database--scripts)
16. [Environment Variables Reference](#environment-variables-reference)
17. [Deployment Notes](#deployment-notes)
18. [Keeping this document updated](#keeping-this-document-updated)

---

## System Overview

The Synozur WebBase is a **pnpm monorepo** with three main runtime artifacts:

| Artifact | Path | Purpose |
|---|---|---|
| **Marketing site** | `artifacts/synozur` | React + Vite public-facing site (also hosts the admin UI) |
| **API server** | `artifacts/api-server` | Express 5 REST API + CMS backend |
| **DB library** | `lib/db` | Drizzle ORM schema + migration source of truth |

Additional shared libraries:

| Library | Path | Purpose |
|---|---|---|
| `lib/api-spec` | OpenAPI source of truth | Drives codegen for Zod schemas and React Query hooks |
| `lib/api-zod` | Zod types + canonical URL helpers | Shared between server and client |
| `lib/api-client-react` | React Query hooks | Auto-generated from the OpenAPI spec |
| `lib/integrations` | HubSpot, Resend wrappers | Server-only integration code |
| `lib/object-storage-web` | Storage abstraction | Wraps GCS and SharePoint Embedded (SPE) |

**Infrastructure:**
- **Database**: PostgreSQL via Drizzle ORM
- **Email**: Resend (transactional)
- **CRM**: HubSpot
- **Identity**: Microsoft Entra ID (OIDC SSO)
- **Object Storage**: SharePoint Embedded (SPE) or Google Cloud Storage (GCS) — switchable per environment from the admin UI
- **Analytics**: GA4, LinkedIn Partner ID, Meta Pixel
- **Spam protection**: Cloudflare Turnstile on all public forms

---

## Accessing the Admin UI

The admin UI is embedded in the marketing site. Navigate to:

```
/admin/dashboard
```

You must be signed in with an account that holds at least the **contributor** role. Most management actions require **editor** or **admin**. Attempting to access admin routes without authentication redirects to `/sign-in`.

**Sign-in options:**
- **Microsoft Entra SSO** — recommended for Synozur staff. Navigate to `/sign-in` and click the Entra button.
- **Local email/password** — available for non-Entra users or local development. Password-reset and email-verification flows are built-in.
- **Dev login** — only available when `ALLOW_DEV_LOGIN=1` and `NODE_ENV !== production`. POST to `/api/auth/dev-login` with `{ "email": "…" }`.

---

## Authentication & Roles

### Roles

| Role | Description |
|---|---|
| `admin` | Full access to all admin areas and settings |
| `editor` | Can publish content; can manage most CMS content types |
| `author` | Can create and edit own content; cannot publish |
| `contributor` | Read-only access to admin area |
| `client` | Portal access for client organizations; no CMS access |

Roles are assigned in **Admin → Access → Users**. They can also be mapped automatically from Microsoft Entra group memberships (see [Access Control](#access-control)).

### Session Management

- Sessions are server-side and stored in the `sessions` table.
- **Idle timeout**: 4 hours by default; tunable in **Admin → Site Config → Site Settings** (`idleTimeoutMs`).
- **Absolute cap**: 30 days.
- Admins can forcibly revoke a user's sessions at **Admin → Access → Users → [user] → Revoke sessions**.
- A user's own active sessions are listed at **Admin → Account → Sessions**.

---

## Admin Navigation Map

```
/admin/dashboard              — Overview metrics

/admin/insights/posts         — Blog post list
/admin/insights/posts/new     — Create post
/admin/insights/posts/:id     — Edit post
/admin/insights/post-analytics — Per-post traffic
/admin/insights/comments      — Comment moderation
/admin/insights/media         — Blog media library
/admin/insights/taxonomy      — Categories & tags

/admin/library/collateral     — Unified content library
/admin/library/carousel       — Homepage carousel curation
/admin/library/white-papers   — White paper editor
/admin/library/videos         — Video editor
/admin/library/workshops      — Workshop editor
/admin/library/polaris        — Polaris podcast episodes
/admin/library/assets         — Asset (image/file) library

/admin/people/team            — Team member roster
/admin/people/events          — Events list
/admin/people/bookings        — Booking pages

/admin/marketing/seo          — SEO defaults & OG settings
/admin/marketing/seo-audit    — Per-page SEO audit & search-engine submission
/admin/marketing/traffic      — Site traffic dashboard
/admin/marketing/hubspot      — HubSpot integration settings

/admin/access/users           — User accounts
/admin/access/organizations   — Client organizations
/admin/access/entra           — Entra group → role mappings
/admin/access/oauth-clients   — OAuth 2.0 / OIDC clients
/admin/access/capabilities    — Fine-grained capability grants
/admin/access/security-log    — Auth audit log

/admin/site-config/site-settings  — Global site settings (theme, hero, HubSpot, SPE, …)
/admin/site-config/health         — API health check
/admin/site-config/redirects      — Wix legacy redirect rules
/admin/site-config/not-found-logs — 404 error log
/admin/site-config/list-page-copy — List page hero copy per content section
/admin/site-config/spe            — SharePoint Embedded storage provisioning

/admin/ai/grounding           — AI grounding document management

/admin/account/sessions       — Current user's active sessions
```

---

## Content Management

### Insights (Blog)

Managed at `/admin/insights/posts`. The Insights section is a full CMS with:

- **Draft / Published / Archived** states
- **Scheduled publishing** — set `publishedAt` to a future date; the api-server scheduler publishes at that time
- **Rich text editor** — body is stored as sanitized HTML; rendered through the `RichText` component to prevent XSS
- **SEO fields** per post: `seoTitle`, `seoDescription`, `ogImage`, `seoTitleLong`, `seoDescriptionShort`, `seoDescriptionLong`
- **Media** — upload images at `/admin/insights/media`; insert via the editor
- **Categories & Tags** — managed at `/admin/insights/taxonomy`
- **Comments** — public threaded discussion; moderated at `/admin/insights/comments`; spam rules tunable in Site Settings
- **Post analytics** — per-post view trends at `/admin/insights/post-analytics`

**Importing from Wix**: The `tools/insights-crawler` standalone tool mirrors the legacy Wix-hosted blog into a typed JSON dataset. Run it before database ingestion when initially migrating posts.

---

## Library & Collateral

All browsable content items (white papers, videos, workshops, Polaris episodes, case studies, applications, etc.) are **unified** in the `collateral` table. This is the runtime authority for what appears in the library, with visibility (`active`), carousel placement (`featured`, `featuredRank`), and pillar/service filtering controlled there.

Each content type also has a **source-of-truth table** with type-specific editorial fields (body HTML, page count, SEO meta, audio URL, etc.). Changes flow from the source table to collateral via sync helpers — **do not edit content fields directly in the collateral admin for synced types**.

### Content type editors

| Content type | Admin path | Source table |
|---|---|---|
| White papers | `/admin/library/white-papers` | `white_papers` |
| Videos | `/admin/library/videos` | `videos` |
| Workshops | `/admin/library/workshops` | `workshops` |
| Polaris episodes | `/admin/library/polaris` | `polaris_episodes` |
| Collateral (generic) | `/admin/library/collateral` | `collateral` (for un-synced types) |

### Homepage Carousel

Curated at `/admin/library/carousel`. Items marked `featured: true` on a collateral row appear in the carousel; `featuredRank` controls sort order.

### Assets

Static images and files are managed at `/admin/library/assets`. The storage backend (GCS or SPE) is configurable per environment in Site Settings.

For full details on the collateral pattern and how to add new content types, see [`docs/content-types.md`](docs/content-types.md).

---

## People, Events & Bookings

### Team Members

Managed at `/admin/people/team`. Fields include name, role/title, bio, photo, tags, sort key, and an `active` toggle. Photos are static files served from object storage.

### Events

Managed at `/admin/people/events`. Supports upcoming and past event listings. Each event has a hero image (uploaded via the asset library), date/time, location, description, and registration link.

### Bookings

Managed at `/admin/people/bookings`. Each booking page maps to a Microsoft Bookings calendar. Two render modes are available, controlled globally in Site Settings:

- **`iframe`** (default) — embeds Microsoft's hosted Bookings page. No extra configuration.
- **`native`** — renders a fully on-brand React flow using Microsoft Graph. Requires:
  - `msBusinessId` set on the booking row (the Bookings calendar's email/Graph id)
  - `ENTRA_TENANT_ID`, `ENTRA_APP_CLIENT_ID`, `ENTRA_APP_CLIENT_SECRET` (or `MS_BOOKINGS_*` overrides)
  - The `Bookings.ReadWrite.All` Graph application permission granted to the app registration

See [`docs/integrations.md`](docs/integrations.md) for full setup instructions.

---

## Marketing & SEO

### SEO Defaults

Set at `/admin/marketing/seo`. Controls:
- Default title template, meta description
- Default OG image
- Twitter/LinkedIn social handles
- Google and Bing site verification tokens
- Organization JSON-LD fields (org name, address, logo, `sameAs` links)

> **Important — site verification (L2)**: Search Console and Bing Webmaster verification crawlers do **not** execute JavaScript, so the `seoGoogleSiteVerification` / `seoBingSiteVerification` DB columns are not enough on their own. The `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` env vars must be set on the SPA server (`artifacts/synozur/server.mjs`), which splices the meta tags directly into the bare HTML response at boot. See [Environment Variables Reference — SPA server](#marketing-site-artifactssynozur) and [`docs/seo-env.md`](docs/seo-env.md).

### SEO Audit

Available at `/admin/marketing/seo-audit`. Audits every published artifact for missing SEO fields and provides:
- **Autofill** — patches `seoTitle`, `seoDescription`, and `ogImage` when they are missing
- **Search-engine submission** — submits URLs to IndexNow (Bing, Yandex, etc.), Google Indexing API, and Bing Webmaster Tools

Credentials for submission channels are environment variables. See [`docs/seo-env.md`](docs/seo-env.md) for the full list.

### Traffic Dashboard

Available at `/admin/marketing/traffic`. Shows session and pageview trends, broken down by path, referrer, and device. Includes a bot-filtering toggle (`includeBots`: `true` | `false` | `only`).

---

## Traffic & Analytics

Client-side analytics tags (GA4, LinkedIn Partner, Meta Pixel) load only **after** the user accepts the cookie-consent banner. Tag IDs are configurable in Site Settings; they fall back to `VITE_*` environment variables if unset.

LinkedIn Partner ID falls back to the hardcoded value `7337793` when neither the DB setting nor the env var is set.

The API server logs crawler/bot pageviews server-side via the `trafficCrawlerMiddleware` middleware so bot traffic is captured even without JavaScript.

At boot the API server logs the live configuration status of every analytics tag under the `launch-readiness: L5 marketing tag` prefix — check startup logs to confirm `VITE_GA4_ID`, `VITE_LINKEDIN_PARTNER_ID`, and `VITE_META_PIXEL_ID` are set from the expected source (DB or env).

---

## Access Control

### Users

Managed at `/admin/access/users`. Admins can:
- Search, view, and edit user profiles
- Assign/revoke roles manually
- Revoke all sessions for a user
- Delete accounts (soft-delete)

### Client Organizations

Managed at `/admin/access/organizations`. Each organization can:
- Have an `entraTenantId` for Entra-based auto-join
- Have `approvedEmailDomains` for email-based auto-join
- Have a `defaultRoleId` granted automatically on sign-in to org members

### Entra Group → Role Mappings

Managed at `/admin/access/entra`. Maps Entra security-group **object IDs** (not display names) to CMS roles. Roles are reconciled on every sign-in:
- Roles mapped from groups the user *belongs to* are granted
- Roles mapped from *any* configured group the user no longer belongs to are revoked
- Manually granted roles (not covered by any group mapping) are preserved

The `entraAdminGroupFallback` site setting grants `admin` to all members of a specified group, regardless of the mapping table — useful for initial bootstrap.

### OAuth / OIDC Clients

Managed at `/admin/access/oauth-clients`. The api-server is itself an OAuth 2.0 / OIDC provider (`/.well-known/openid-configuration`, `/oauth/*`). Registered clients appear here.

### Security Log

Available at `/admin/access/security-log`. Records authentication events (sign-in, sign-out, failed attempts, session revocations).

---

## Site Configuration

Managed at `/admin/site-config/site-settings`. Key settings:

| Setting | Description |
|---|---|
| `siteTheme` | `"cosmic"` (default) or `"aurora"` — CSS token set applied site-wide |
| `homeHeroBackgroundType` | `"image"` or `"video"` — controls homepage hero |
| `homeHeroImageMediaId` / `homeHeroVideoMediaId` | Hero media asset |
| `requireCookieConsent` | Whether the cookie-consent banner is shown |
| `idleTimeoutMs` | Session idle timeout in milliseconds (default 4 hours) |
| `entraEnabled` | Enables the Entra SSO sign-in button |
| `entraAdminGroupFallback` | Entra group object ID that always receives `admin` role |
| `bookingsRenderMode` | `"iframe"` or `"native"` for Microsoft Bookings pages |
| `hubspotEnabled` | Master switch for HubSpot sync |
| `hubspotTimelineAppId` | HubSpot Public App ID for timeline events |
| `speContainerTypeId` / `speContainerIdDev` / `speContainerIdProd` | SharePoint Embedded storage container IDs |
| `storageBackendDev` / `storageBackendProd` | `"gcs"` or `"spe"` per environment |
| `spamLinkThreshold` | Max external links before a comment is auto-flagged |
| `spamKeywords` | JSON array of blocked keywords |
| `spamDomainBlocklist` | JSON array of blocked email domains for comments |

### Other Site Config pages

| Page | Purpose |
|---|---|
| `/admin/site-config/health` | Real-time API and DB health check |
| `/admin/site-config/redirects` | Manage legacy Wix URL redirect rules |
| `/admin/site-config/not-found-logs` | Review logged 404 errors |
| `/admin/site-config/list-page-copy` | Edit hero/intro copy for each content-listing section |
| `/admin/site-config/spe` | Provision SharePoint Embedded containers |

---

## AI Grounding

Managed at `/admin/ai/grounding`. Grounding documents feed context into Anthropic AI chat responses. Admins can create, edit, and delete grounding entries. The integration is powered by `lib/integrations-anthropic-ai`.

---

## Integrations

Full configuration runbooks are in [`docs/integrations.md`](docs/integrations.md). Summary:

### HubSpot

- Lead-capture sync: form submissions upsert HubSpot Contacts and emit custom timeline events.
- Managed at `/admin/marketing/hubspot`.
- Token sourced from Replit Connections (preferred) or `HUBSPOT_ACCESS_TOKEN` env var.
- Custom Contact properties `synozur_form_type` and `synozur_marketing_opt_in` must be created in HubSpot once.
- In-process worker drains the queue every 30 seconds.

### Microsoft Entra SSO

- Native OIDC flow; no third-party identity provider.
- Group reconciliation via Microsoft Graph on every sign-in.
- One-time setup: app registration with `openid`, `profile`, `email`, `User.Read`, and `GroupMember.Read.All` permissions.

### Microsoft Bookings (native mode)

- Requires `Bookings.ReadWrite.All` Graph application permission on the Entra app registration.
- Requires `msBusinessId` on each booking row.

### Resend (Email)

- Used for all transactional emails: form confirmations, notifications, email verification, password reset.
- Configured via `RESEND_API_KEY` environment variable.

---

## Asset & Media Storage

Two storage backends are supported and are switchable per environment from the Site Settings admin page:

| Backend | Key | Notes |
|---|---|---|
| Google Cloud Storage | `"gcs"` | Legacy default |
| SharePoint Embedded | `"spe"` | Preferred for new deployments; provisioned via `/admin/site-config/spe` |

SPE requires the Synozur Entra app registration to have the necessary Graph permissions and a one-time container provisioning step in the admin UI.

---

## Database & Scripts

### Drizzle ORM

The schema is the source of truth in `lib/db/src/schema/`. Changes to the schema require a Drizzle migration:

```bash
# Generate migration from schema changes
pnpm --filter @workspace/db drizzle-kit generate

# Apply pending migrations
pnpm --filter @workspace/db drizzle-kit migrate
```

### Seed scripts

One-time seed and backfill scripts live in `artifacts/api-server/src/scripts/`. They are idempotent by design. Common scripts:

| Script | Purpose |
|---|---|
| `seedContentParentPages.ts` | Seeds the fixed set of content section list pages |
| `seedCollateral.ts` | Bulk-seeds collateral rows |
| `seedTeamMembers.ts` | Seeds initial team member rows |
| `seedPosts.ts` | Seeds blog posts from the crawler output |
| `backfillCollateralHeroAssets.ts` | Migrates hero images to the media table |
| `provisionColumnsAll.ts` | Runs all column provisioning / backfill steps |

Run a script with:

```bash
pnpm --filter @workspace/api-server tsx src/scripts/<scriptName>.ts
```

> **Adding a new list page section**: `content_parent_pages` is seeded from a fixed `SLUGS` array in `seedContentParentPages.ts`. There is no admin "create" flow — add the slug to that array and re-run the seed.

---

## Environment Variables Reference

### API Server (`artifacts/api-server`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **yes** | PostgreSQL connection string |
| `SESSION_SECRET` | **yes** | Secret for signing session tokens |
| `RESEND_API_KEY` | yes | Resend email API key |
| `ENTRA_TENANT_ID` | yes (SSO) | Entra tenant GUID |
| `ENTRA_APP_CLIENT_ID` | yes (SSO) | Entra app registration client ID |
| `AUTH_REDIRECT_URI` | yes (SSO) | Absolute callback URL, must match app registration |
| `ENTRA_APP_CLIENT_SECRET` | conditional | Required for confidential app or Graph app-only tokens |
| `AUTH_POST_LOGOUT_URI` | optional | Post-logout redirect URL |
| `ADMIN_EMAILS` | optional | Comma-separated bootstrap admin email allow-list |
| `ALLOW_DEV_LOGIN` | optional | Set to `1` to enable dev sign-in (non-production only) |
| `HUBSPOT_ACCESS_TOKEN` | optional | HubSpot private app token (fallback when Replit Connections unavailable) |
| `HUBSPOT_PORTAL_ID` | display only | HubSpot portal ID (shown in admin UI) |
| `INDEXNOW_KEY` | optional | IndexNow search-engine submission key |
| `GOOGLE_INDEXING_SA_JSON` | optional | Google service account JSON for Indexing API |
| `BING_API_KEY` | optional | Bing Webmaster Tools API key |
| `BING_SITE_URL` | optional (with `BING_API_KEY`) | Exact verified site URL in Bing Webmaster Tools |
| `SITE_URL` | optional | Base URL; defaults to `https://www.synozur.com` |
| `MS_BOOKINGS_TENANT_ID` | optional | Override for Bookings tenant (defaults to `ENTRA_TENANT_ID`) |
| `MS_BOOKINGS_CLIENT_ID` | optional | Override for Bookings app client ID |
| `MS_BOOKINGS_CLIENT_SECRET` | optional | Override for Bookings client secret |
| `TURNSTILE_SECRET_KEY` | optional | Cloudflare Turnstile server-side secret |
| `IDLE_TIMEOUT_MS` | optional | Session idle timeout in ms (default 4 hours) |
| `CSP_ENFORCE` | optional | Set to `1` to flip CSP from Report-Only to enforcing mode on both servers. Default (unset) keeps the policy in report-only mode; see [CSP rollout](#csp-rollout) |

### SPA server (`artifacts/synozur/server.mjs`)

Runtime env vars read by `server.mjs` (not baked into the Vite bundle):

| Variable | Description |
|---|---|
| `GOOGLE_SITE_VERIFICATION` | Google Search Console verification token. Spliced into `<head>` as `<meta name="google-site-verification">` at boot so verification crawlers (which don't run JS) can confirm site ownership. Rotation requires a redeploy. |
| `BING_SITE_VERIFICATION` | Bing Webmaster Tools verification token. Spliced in as `<meta name="msvalidate.01">`. |
| `CSP_REPORT_URI` | Override the CSP `report-uri` directive on the SPA server. Defaults to `/api/csp/report`. |
| `CSP_ENFORCE` | Set to `1` to flip CSP from Report-Only to enforcing (shared with API server). |
| `PORT` | SPA server listen port (default `20131`) |
| `API_PORT` | API server port for OG-tag proxy (default `8080`) |

### Marketing site — Vite build vars (`artifacts/synozur`)

| Variable | Description |
|---|---|
| `VITE_API_URL` | API server base URL |
| `VITE_GA4_ID` | Google Analytics 4 measurement ID (overridden by DB setting) |
| `VITE_LINKEDIN_PARTNER_ID` | LinkedIn Partner ID (overridden by DB setting; hardcoded fallback: `7337793`) |
| `VITE_META_PIXEL_ID` | Meta Pixel ID (overridden by DB setting) |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile public site key |

---

## Deployment Notes

- **Deployment model**: Pre-release. Replit (dev) is the primary content-entry environment. Production is a read-only preview kept in sync by periodically re-syncing the dev database.
- The build runs `pnpm run typecheck && pnpm -r --if-present run build` from the workspace root.
- The API server is compiled with `esbuild` (`artifacts/api-server/build.mjs`).
- The marketing site uses Vite.
- The API server must be started before the marketing site; the site proxies `/api/*` to the server.
- SEO artifacts (`/sitemap.xml`, `/robots.txt`, `/llms.txt`) are served directly at the site root by the API server.

### Security headers

Both the API server (`artifacts/api-server/src/lib/securityHeaders.ts`) and the SPA server (`artifacts/synozur/server.mjs`) emit the same set of security headers on every response:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (2 years) |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Content-Security-Policy-Report-Only` (or `Content-Security-Policy`) | CSP allowlist (see below) |

The CSP allowlist covers GA4, LinkedIn Insight, Meta Pixel, YouTube, Microsoft Bookings, Google Fonts, Cloudflare Turnstile, and the Libsyn player. When adding a new third-party tag or embed, update **both** `artifacts/api-server/src/lib/securityHeaders.ts` and `artifacts/synozur/server.mjs` to keep the policies in sync.

#### CSP rollout

The CSP ships in **Report-Only mode** by default (browsers post violations to `POST /api/csp/report` but nothing is blocked). Violations are deduplicated into the `csp_violations` table — one row per `(document_path, violated_directive, blocked_uri)` with an `occurrences` counter.

Rollout steps per `backlog.md`:
1. Deploy with `CSP_ENFORCE` unset (report-only). Monitor the `csp_violations` table.
2. Run for ≥ 7 days against production traffic.
3. Once the violation stream is empty for two consecutive days, set `CSP_ENFORCE=1` and redeploy to flip to enforcing mode.

### Launch-readiness startup log

The API server logs the live status of all Tier 1 launch-readiness configuration at boot. Check these prefixes in startup logs to verify production secrets are set:

| Prefix | What it checks |
|---|---|
| `launch-readiness: L2` | `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` (SPA server logs these separately) |
| `launch-readiness: L3 SEO submission` | `INDEXNOW_KEY`, `GOOGLE_INDEXING_SA_JSON`, `BING_API_KEY`+`BING_SITE_URL` |
| `launch-readiness: L5 marketing tag` | `VITE_GA4_ID`, `VITE_LINKEDIN_PARTNER_ID`, `VITE_META_PIXEL_ID` (DB or env) |

Unconfigured channels log at `warn` level; configured channels log at `info`.

---

## Keeping this document updated

This document (`admin-guide.md`) is the canonical admin reference for the Synozur WebBase. **Agents and developers adding or removing functionality are expected to update the relevant section(s)** as part of their change.

### Guidelines for agents

1. **Scope your updates**: Only modify sections that are directly affected by your change. Do not rewrite unrelated sections.
2. **Admin navigation map**: If you add or remove an admin route, update the [Admin Navigation Map](#admin-navigation-map) table.
3. **Environment variables**: If you add, remove, or rename an environment variable, update the [Environment Variables Reference](#environment-variables-reference) table.
4. **Site settings**: If you add a column to `site_settings`, add a row to the table in [Site Configuration](#site-configuration).
5. **Content types**: If you add a new content type (following the pattern in `docs/content-types.md`), add a row to the [Library & Collateral](#library--collateral) content-type table.
6. **Integrations**: If you add a new third-party integration, create a sub-section under [Integrations](#integrations) and add a full runbook entry in `docs/integrations.md` (per existing `docs/` conventions).
7. **Database scripts**: If you add a new seed or backfill script, add a row to the [Seed scripts](#seed-scripts) table.
8. **Keep descriptions concise**: One or two sentences per feature is enough. Link to `docs/` files for long-form runbooks.
9. **Do not re-order sections** without a strong reason. The Table of Contents is manually maintained — update it when adding or removing sections.
10. **Verify** that any admin URL you reference actually exists in `artifacts/synozur/src/pages/admin/` before adding it.

### Checklist for any PR that adds a feature

- [ ] Have I added or updated an entry in the [Admin Navigation Map](#admin-navigation-map)?
- [ ] Have I updated [Environment Variables Reference](#environment-variables-reference) for any new/changed env vars?
- [ ] Have I updated [Site Configuration](#site-configuration) for any new `site_settings` columns?
- [ ] Have I updated the appropriate content or integration section if applicable?
- [ ] Have I updated the [Seed scripts](#seed-scripts) table if a new script was added?
