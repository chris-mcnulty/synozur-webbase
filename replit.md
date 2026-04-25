# Workspace

## Deployment Policy

**Pre-release mode.** The site is under active development and not yet publicly launched. Production is kept in sync with development by suspending the deployed app and re-syncing the development database to production — not by maintaining content separately in both environments. Do not assume production content needs to be managed independently; all content entry happens in the development (Replit) environment and is promoted to production as a whole via re-sync.

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
  - **Events system** (`/events`): Public Upcoming + Past listings backed by `GET /api/events`. Admin area at `/admin` (auth via native Entra OIDC, allow-listed via `ADMIN_EMAILS` env var or by Entra-group-mapped role) provides full CRUD over events with an Asset Library modal that uploads images via Uppy + Object Storage (`POST /api/storage/uploads/request-url`). Sign-in at `/sign-in` redirects to Microsoft. Events are linked to assets through `events.image_asset_id`. Seeding script: `pnpm dlx tsx artifacts/api-server/src/scripts/seedEvents.ts` (reads `attached_assets/events_1776704614264.csv`).
- **HubSpot integration** (`artifacts/api-server/src/lib/hubspotSync.ts`, #131): every successful form submission (contact / subscribe / start) is enqueued in `hubspot_sync_events` and drained by an in-process worker (`startHubspotWorker`, 30s tick) that upserts a Contact and emits a custom timeline event. Persisting outside the request path means a HubSpot outage doesn't block visitor responses; failures are retried with exponential backoff and dead-lettered after 6 attempts. **Token resolution**: when `REPLIT_CONNECTORS_HOSTNAME` is set, the access token is fetched from the Replit Connections sidecar (`/api/v2/connection?connector_names=hubspot`) and cached until shortly before expiry; otherwise we fall back to a static `HUBSPOT_ACCESS_TOKEN` env var. Other config: `HUBSPOT_PORTAL_ID` for the admin display; runtime knobs (enabled flag, per-form-type toggles, lifecycle stage mappings, EU opt-in default, timeline app id) live in `site_settings` and are tuned at `/admin/integrations/hubspot`. First-touch attribution captured client-side on first landing (`artifacts/synozur/src/lib/attribution.ts`) and posted with the form payload — written onto the contact's first/last-touch properties at upsert. GDPR erasure available via `POST /api/admin/integrations/hubspot/erasure`.
- **Authentication — multi-method** (`artifacts/api-server/src/routes/auth.ts`):
  - **Entra SSO** (`lib/entraOidc.ts` + `lib/entra.ts`, #126): native OIDC authorization-code + PKCE flow against the Entra v2.0 endpoint. Supports both Synozur's own tenant (full group reconciliation via Microsoft Graph) and external client org tenants (tenant allowlist from `client_organizations.entraTenantId`, assigns org's defaultRole, skips group reconciliation). The app-only token cache is keyed per tenant ID so tokens for different directories don't collide.
  - **Multi-environment redirect URIs**: `AUTH_REDIRECT_URI` is optional. When unset, the callback URI is derived dynamically from each request's `x-forwarded-host` header so dev (Replit preview domain) and prod (custom domain) both work with the same code. The derived URI is stored in `auth_pending_states.redirect_uri` and echoed exactly during token exchange — required by OIDC spec.
  - **Local email/password** (`POST /api/auth/register`, `POST /api/auth/login`): bcrypt-hashed passwords stored in `users.password_hash`. Constant-time verification to prevent timing-based user enumeration. Domain-based auto-join: on registration, the user's email domain is checked against all active orgs' `approvedEmailDomains` — matching auto-links the user and grants the org's default role immediately. Users can also pass `organizationSlug` to request org membership.
  - **Email verification**: new local registrants receive a verification email (via Resend / `sendEmailVerification`) with a 24-hour single-use token stored in `email_verification_tokens`. `POST /api/auth/verify-email` (consumes token), `POST /api/auth/resend-verification` (always 200 to prevent enumeration). Entra SSO users are implicitly verified. `users.email_verified` boolean tracks status. Session is created immediately on registration; features may gate on `emailVerified`.
  - **Password reset**: `POST /api/auth/forgot-password` always returns 200 (prevents enumeration) and sends a 1-hour token via `sendPasswordReset` (stored in `password_reset_tokens`). `POST /api/auth/reset-password` consumes the token, bcrypt-hashes the new password, and deletes all remaining reset tokens for that user. Frontend pages: `/forgot-password`, `/reset-password`.
  - **Public auth pages**: `/sign-in` (email+password form, optionally shows "Continue with Microsoft" when Entra is configured, links to forgot-password and sign-up), `/sign-up` (name + email + password + confirm, post-registration shows verify-email notice), `/verify-email` (auto-POSTs token from URL), `/forgot-password`, `/reset-password`.
  - **Sessions**: server-side `sessions` table, `sid` HttpOnly cookie carrying only a random token. Any session revocable unilaterally.
  - **Roles**: `admin`, `editor`, `author`, `contributor`, `client` (new). `client` is the standard role for org members.
  - Config: `ENTRA_TENANT_ID` (Synozur's own tenant GUID or `"organizations"` for multi-tenant Azure app), `ENTRA_APP_CLIENT_ID`, optional `ENTRA_APP_CLIENT_SECRET`, optional `AUTH_REDIRECT_URI`, optional `AUTH_POST_LOGOUT_URI`, optional `ADMIN_EMAILS`, optional `ALLOW_DEV_LOGIN=1`.
- **Client organizations** (`lib/db/src/schema/clientOrganizations.ts`, `routes/clientOrgs.ts`): the unit of portal access. Each org has a name/slug, optional `entraTenantId` (for Entra SSO auto-join), `approvedEmailDomains` (for email/password auto-join), `isActive`, and `defaultRoleId`. Any user linked to an active org receives `defaultRoleId` on every sign-in. Admin UI at `/admin/access/organizations`. API: `GET/POST /api/admin/client-orgs`, `PATCH/DELETE /api/admin/client-orgs/:id`, `GET/POST /api/admin/client-orgs/:id/members`, `DELETE /api/admin/client-orgs/:id/members/:userId`. This website is designed to become an OAuth provider for other Synozur-built apps — the user model (local credentials + org membership + roles) is the foundation.
- **Entra group → role mappings** (`/admin/access/entra`): now scoped by `clientOrganizationId`. NULL = Synozur-internal mapping; non-NULL = scoped to a specific client org's directory. Partial unique indexes (`entra_group_role_synozur_unique`, `entra_group_role_client_unique`) enforce uniqueness within each scope.
- `artifacts/api-server` — Express 5 API server hosting the **Insights CMS** backend.
  - Auth: native Entra OIDC + cookie-bound server-side sessions. `attachUserIfPresent` middleware resolves the `sid` cookie globally; `requireAuth` / `requireAdmin` gate downstream routes. First user to sign in is auto-promoted to `admin`. A dev-only `POST /api/auth/dev-login` endpoint is available when `ALLOW_DEV_LOGIN=1` and the request originates from localhost — handy for working on the admin without an Entra tenant.
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
