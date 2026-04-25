# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Tools

- `tools/insights-crawler` — standalone, build-time crawler that mirrors the public Wix-hosted blog at `https://www.synozur.com/insights` into a typed JSON dataset for downstream DB ingest. Outputs to `tools/insights-crawler/output/`: `discovered.json`, `posts.json` (sorted by publishedAt desc, image URLs are local relative paths), `images/<slug>/...` (resized to ≤1920px wide), and `report.md`. Idempotent (HTML cache in `output/.cache/`, skips already-extracted posts unless `--force`). Runs locally only — does not run on the production server. Commands: `pnpm --filter @workspace/insights-crawler run discover` then `... run crawl` (or `run all`). See its README for details.

## Artifacts

- `artifacts/synozur` — React + Vite marketing site for **The Synozur Alliance** ("The Transformation Company"). Cosmic / North Star brand, violet `#810FFB` primary with a custom `nebula-gradient` utility defined in `src/index.css`. Routing via wouter under `BASE_URL` (mounted at `/`).
  - Pages: `/`, `/about`, `/services-overview/default`, `/services/:slug` (four pillars), `/clients`, `/case-studies`, `/case-studies/:slug`, `/applications`, `/applications/:slug` (Vega, Nebula, Constellation, Orion, Orbit, Zenith, Holidays & Birthdays Web Part), `/team`, `/partners`, `/insights`, `/polaris`, `/contact`, `/start`, plus a cosmic 404.
  - Application content lives in `src/data/applications.ts`; assets in `public/images/applications/` (downloaded from Wix CDN, resized).
  - Layout in `src/components/layout` (Header with nav dropdowns + mobile drawer, Footer with subscribe + columns).
  - Forms use `react-hook-form` + `zod` and POST to real backend endpoints under `/api/forms/*` (`submitContact`, `submitSubscribe`, `submitStart`). Server-side validation via generated Zod schemas, persistence in `form_submissions` table, optional webhook forwarding via `FORMS_WEBHOOK_URL`, honeypot field, and pluggable Cloudflare Turnstile via `TURNSTILE_SECRET_KEY` (active only when set).
  - **Transactional email** (`artifacts/api-server/src/lib/email.ts`): when `RESEND_API_KEY` is set, every successful form submission triggers (a) a branded confirmation email to the visitor (skipped for subscribe if no email — but subscribe always has one) and (b) a notification to `FORMS_NOTIFY_EMAIL` (skipped if unset) with the full submission payload and `Reply-To` set to the visitor. From-address controlled by `EMAIL_FROM` (default `The Synozur Alliance <hello@synozur.com>`). `SITE_URL` (default `https://synozur.com`) is rendered in the footer. Email sends are fire-and-forget via `void`; failures are logged via pino but never break the submission response. With no `RESEND_API_KEY`, sends log as `skipped` and the system behaves exactly as before. **Domain verification (one-time ops task):** `synozur.com` must be verified in Resend with SPF + DKIM + DMARC published in DNS or messages will land in spam / be rejected. Step-by-step runbook in `docs/email-domain-verification.md`.
  - SEO via `src/lib/meta.tsx` (per-page title, description, OG/Twitter, canonical). Global Organization JSON-LD via `src/components/organization-jsonld.tsx`.
  - Analytics + cookie consent via `src/components/analytics.tsx`. Reads `VITE_GA4_ID`, `VITE_LINKEDIN_PARTNER_ID` (defaults to `7337793`), `VITE_META_PIXEL_ID`. Marketing tags load only after consent (stored in `localStorage` under `synozur.cookieConsent.v1`).
  - Home "From The Feed" carousel data lives in `src/data/feed.ts`; carousel images in `public/images/home/feed/` (downloaded from Wix CDN, originals resized).
  - Initial prompt baseline saved at `.local/baselines/peanut-baseline.md`.
  - **Insights comments** (`/insights/:slug`): public Discussion section under each post (`src/components/comments/`). Renders approved comments threaded one level deep (replies attach to the nearest top-level ancestor). Visitor submission form (name, email, body, hidden honeypot `website` positioned off-screen) POSTs to `/api/insights/:slug/comments` (rate-limited 5/10min/IP, server-side honeypot returns 202 silently). Body rendering escapes HTML, preserves line breaks, and only auto-links http(s) URLs. A comment-count chip in the post header links to `#discussion` and re-fetches on window focus so newly approved comments appear without a manual reload. Email is never returned by `GET /api/insights/:slug/comments` or rendered in the UI.
  - **Team system** (`/team`): Public team grid backed by `GET /api/team-members` (active only, ordered by `manualSort` then name). Admin CRUD at `/admin/team-members` with active toggle, sort key, tags, and HTML short/long descriptions. Photos are stored as static files under `artifacts/synozur/public/images/team/<slug>.<ext>`. Seeded from Wix CSV via `pnpm dlx tsx artifacts/api-server/src/scripts/seedTeamMembers.ts` (reads `attached_assets/Team_1776707186693.csv`, downloads `wix:image://` photos to local static dir, idempotent by slug).
  - **Events system** (`/events`): Public Upcoming + Past listings backed by `GET /api/events`. Admin area at `/admin` (Clerk-auth'd, allow-listed via `ADMIN_EMAILS` env var) provides full CRUD over events with an Asset Library modal that uploads images via Uppy + Object Storage (`POST /api/storage/uploads/request-url`). Sign-in / sign-up at `/sign-in` and `/sign-up` (Clerk hosted components, dev keys via `VITE_CLERK_PUBLISHABLE_KEY`). Events are linked to assets through `events.image_asset_id`. Seeding script: `pnpm dlx tsx artifacts/api-server/src/scripts/seedEvents.ts` (reads `attached_assets/events_1776704614264.csv`).
- **HubSpot integration** (`artifacts/api-server/src/lib/hubspotSync.ts`, #131): every successful form submission (contact / subscribe / start) is enqueued in `hubspot_sync_events` and drained by an in-process worker (`startHubspotWorker`, 30s tick) that upserts a Contact and emits a custom timeline event. Persisting outside the request path means a HubSpot outage doesn't block visitor responses; failures are retried with exponential backoff and dead-lettered after 6 attempts. Configuration: `HUBSPOT_ACCESS_TOKEN` (private-app token), `HUBSPOT_PORTAL_ID` env vars; runtime knobs (enabled flag, per-form-type toggles, lifecycle stage mappings, EU opt-in default, timeline app id) live in `site_settings` and are tuned at `/admin/integrations/hubspot`. First-touch attribution captured client-side on first landing (`artifacts/synozur/src/lib/attribution.ts`) and posted with the form payload — written onto the contact's first/last-touch properties at upsert. GDPR erasure available via `POST /api/admin/integrations/hubspot/erasure`.
- **Microsoft Entra SSO** (`artifacts/api-server/src/lib/entra.ts`, #126): when a user authenticates via the Clerk Enterprise SSO connection bound to the Entra tenant (typically `@synozur.com`), `loadOrCreateUser` mirrors the tenant + object id onto the user row, resolves the user's transitive group membership via Microsoft Graph, and reconciles `user_roles` against admin-managed mappings in `entra_group_role_mappings`. Roles previously sourced from a group the user no longer belongs to are removed on next sign-in — Entra offboarding instantly removes CMS access. Configuration: `ENTRA_TENANT_ID` (or per-connection metadata in Clerk), optional app-only credentials (`ENTRA_APP_CLIENT_ID` + `ENTRA_APP_CLIENT_SECRET`) for portals where the delegated SSO token doesn't carry `GroupMember.Read.All`. Group → role mappings managed at `/admin/access/entra`.
- `artifacts/api-server` — Express 5 API server hosting the **Insights CMS** backend.
  - Auth: Clerk (`@clerk/express`); Clerk frontend API is reverse-proxied at `/__clerk/*` (must be mounted before body parsers). First user to sign in is auto-promoted to `admin`.
  - **Auth roadmap (not immediate):** Clerk is a short-term choice, not a commitment. The plan is to replace it with an in-house identity layer (email + Entra ID + Google SSO) and have this site act as the OAuth provider for the rest of the Synozur app portfolio — the in-design client portal **Galaxy** and the apps under `/applications` (Vega, Nebula, Constellation, Orion, Orbit, Zenith, etc.). When designing auth-adjacent code (roles, sessions, user model, admin gating), prefer abstractions that don't hard-code Clerk-specific assumptions so the swap is tractable later.
  - Authorization: role-based — `admin`, `editor`, `author`, `contributor`. Authors/contributors can only see/edit their own draft posts; only admin/editor can publish, archive, moderate, or manage taxonomy/users.
  - Routes:
    - `GET /api/auth/me`
    - `GET/POST/PATCH/DELETE /api/cms/posts` + `/:id/publish|schedule|archive`
    - `GET/POST/PATCH/DELETE /api/cms/categories|tags`
    - `GET/POST/DELETE /api/cms/media` (registers Replit App Storage uploads)
    - `GET /api/cms/comments` + `POST /api/cms/comments/:id/moderate`
    - `GET /api/cms/users` + `PUT /api/cms/users/:id/roles`
    - Public: `GET /api/insights`, `GET /api/insights/:slug`, `GET /api/insights/:slug/comments`, `POST /api/insights/:slug/comments` (rate-limited per IP, comments land as `pending`)
    - Storage: object-storage upload-url + serve routes from the standard template
  - Scheduler: in-process `setInterval` worker (60s tick) promotes `scheduled` posts whose `scheduledFor <= now` to `published`.
  - Audit log on every mutation in the `audit_log` table.
- `lib/db` — Drizzle schema for the CMS:
  - `users` (linked to `clerk_user_id`), `roles`, `user_roles`
  - `posts` (uuid PK, `slug` unique, soft-delete via `deletedAt`, status `draft|scheduled|published|archived`, hero/og media refs), `revisions` (snapshot JSON on every update)
  - `categories`, `tags`, `post_categories`, `post_tags`
  - `media` (object-storage entity URLs)
  - `comments` (status `pending|approved|spam|deleted`, IP/user-agent captured)
  - `audit_log` (actor, action, entity, diff JSON)
  - Seed (`pnpm --filter @workspace/db run seed`) ensures the four roles + a default `general` category.
- `lib/api-spec` / `lib/api-zod` / `lib/api-client-react` — OpenAPI is the source of truth; `pnpm --filter @workspace/api-spec run codegen` regenerates Zod schemas (`@workspace/api-zod`) and React Query hooks/types (`@workspace/api-client-react`).
  - Note: `lib/api-zod` only re-exports the Zod schemas to avoid name collisions with the generated TS types; consume types via `z.infer<typeof Schema>` or from `@workspace/api-client-react/api.schemas`.
