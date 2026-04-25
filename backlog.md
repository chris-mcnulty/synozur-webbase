# Synozur Alliance — Product Backlog

> Last updated: April 25, 2026  
> 27 tasks pending · 93 merged · 29 cancelled

Tasks are grouped by theme. Each entry includes the task reference, a plain-English description of what needs to be built, and which earlier work it depends on.

---

## Services & Solutions Admin

### #57 · Verify the new services pages with automated browser tests
**Depends on:** #40 (services pages refactor)

The services hierarchy is the most commercially critical part of the site. This task writes Playwright end-to-end tests covering: home → Services nav → services overview page → service detail → solution detail, verifying content renders and links resolve. Tests run in CI so regressions are caught before merge.

### #62 · Bulk import services and solutions from a spreadsheet
**Depends on:** #39 (services hierarchy admin UI)

Currently the services and solutions data can only be updated row-by-row through the admin edit form or by re-running the seed script. This task adds a CSV/XLSX upload endpoint (`POST /api/admin/services/import` and `/solutions/import`) and a drag-and-drop import UI in the admin, with a column-mapping step and a dry-run preview before commit. Useful for quarterly content refreshes.

---

## Content Library

### #68 · Automatically trim old revisions to keep storage lean
**Depends on:** #48 (post revisions)

Every save creates a new revision. Without a retention policy, the `post_revisions` table grows indefinitely. This task adds a scheduled job (daily cron) that deletes revisions older than 90 days, keeping the 10 most recent regardless of age. The retention window and keep-count should be configurable via admin site settings.

### #120 · Move the featured-items carousel manager to a dedicated admin tab with thumbnail and type views
**Depends on:** #118 (hero thumbnails in Library admin list) — merged

The "Featured items" reorder card is currently inline at the top of `artifacts/synozur/src/pages/admin/library/collateral-list.tsx` (lines 531–605) — it shows only items already flagged featured, stacked above the full collateral table, which mixes two concerns (curate the home carousel / browse the whole library). Promote the carousel manager to its own admin page (e.g. `/admin/library/carousel`) with two view modes: a **thumbnail grid view** that renders each featured item as a full-size card (hero image + title + type chip) for visual drag-to-reorder, and a **type view** that groups the featured set by artifact type (collateral / video / white-paper / workshop) so marketing can see and balance the mix that will appear in the home carousel and featured-library row. Keep the existing featured-rank persistence and drag-to-reorder behavior. Remove the inline featured card from the collateral list once the new tab is live.

### #121 · Sortable columns on the collateral library admin list
**Depends on:** #69 (library live content) — merged

The admin collateral table in `artifacts/synozur/src/pages/admin/library/collateral-list.tsx` uses static `<TableHead>` cells (lines 729–756) — editors cannot reorder by title, type, service, solution, pillar, featured rank, or last-updated. The backend `GET /cms/collateral` in `artifacts/api-server/src/routes/collateral.ts` (lines 212–224) has a hard-coded `ORDER BY featured DESC, featuredRank ASC NULLS LAST, publishedAt DESC, title ASC` and the `ListQuery` schema (lines 13–26) accepts no sort param. This task adds a `sort` query param (e.g. `sort=title:asc` or `sort=updatedAt:desc`) validated against an allow-list of sortable columns, threads it through the generated API client, and makes each `<TableHead>` clickable with an arrow indicator showing the current direction. Clicking cycles asc → desc → default. The same pattern should be reusable by the sibling videos / white-papers / workshops admin lists in follow-up work.

### #122 · Multiple resource attachments on library items (slides + transcript + code + …)
**Depends on:** #63 (asset categories beyond people/north-star) — merged

Webinars, workshops, and white papers typically ship with more than one companion file — slides, transcript, Q&A log, code repo link, follow-up deck — but the only attachment slot today is a single `downloadUrl` text column on `collateral` (see `lib/db/src/schema/collateral.ts` and the "Download URL" input in `artifacts/synozur/src/pages/admin/library/collateral-edit.tsx`). Editors work around it by concatenating URLs into the body HTML, which breaks the public library detail page's tidy "Download" CTA. This task adds a `collateral_resources` table with `(id, collateralId, assetId, externalUrl, label, mimeType, sortOrder, createdAt)` — asset-backed rows link to the unified `assets` table for uploaded files; externalUrl rows cover off-platform links (GitHub, Figma, external CDNs). Admin edit form gains a "Resources" list editor with drag-to-reorder and inline label; public library detail page (`artifacts/synozur/src/pages/library-detail.tsx`) renders a Resources section when rows exist, falling back to the legacy `downloadUrl` when empty. Keep `downloadUrl` on the schema for now as a read-only mirror of the first resource; deprecate in a follow-up.

### #127 · Migrate asset storage from Google Cloud Storage to SharePoint Embedded
**Depends on:** — (infrastructure foundation)

Today `artifacts/api-server/src/lib/objectStorage.ts` speaks to Google Cloud Storage through the Replit sidecar (`http://127.0.0.1:1106/token`) — a convenient default on Replit but not where Synozur governs its document lifecycle. All uploaded assets (hero images, carousel tiles, eventual white-paper/webinar PDFs) live in a GCS bucket behind the `/api/storage/{storageKey}` endpoint; ACL state is mirrored in `objectAcl.ts`. This task replaces the GCS backend with SharePoint Embedded (SPE) — a Microsoft Graph-exposed container format that keeps files inside the tenant's own compliance and retention perimeter (DLP, eDiscovery, sensitivity labels) while preserving programmatic access. Introduce an `AssetStorageBackend` abstraction that the existing `ObjectStorageService` delegates to (so routes and the AssetLibraryModal stay unchanged), implement an SPE driver over the Graph API using an app-only token from Entra, and add a one-shot migration script that streams every object from GCS to an SPE container, rewriting `assets.storageKey` rows (and any legacy URL references in `collateral.heroImage`, `white_papers.documentUrl`, `videos.thumbnailUrl`, etc.) as it goes. During the cutover window both drivers run side-by-side behind a `STORAGE_BACKEND=gcs|spe` env flag so we can flip per-environment; decommission the GCS bucket once SPE traffic is verified for ≥30 days.

### #138 · Programmatic case-study drafts from Constellation engagement outcomes
**Depends on:** #128 (OAuth provider, so Constellation can talk back to this site as a registered client); pairs with consent workflow inside Constellation

Synozur runs more delivery work through Constellation (`scdp.synozur.com`) than the marketing team can write up — every engagement accumulates real artifacts (timeline adherence, risks burned down, hours saved, AI-synthesized executive narratives) that would make excellent case studies, but turning them into publishable copy today means a manual interview cycle weeks after the project closes. This task builds a **case-study drafting pipeline** that pulls anonymized Constellation outcomes into this site's CMS as `draft` rows for editor review. Scope: a new outbound API in Constellation publishes per-engagement summaries to `POST /api/cms/case-study-drafts` on this server (authenticated as a registered OAuth client per #128, with the `case_study.draft` scope); the endpoint validates the payload (project name, client display name, sector, summary metrics, key risks mitigated, timeline, anonymization flag), runs it through a draft-generation prompt against Claude (configurable model/version, prompt versioned in DB so we can A/B), and inserts a `draft` post into the existing `case_studies` table linked to the `collateral` artifact. Admin UI in `pages/admin/library/case-studies/` gains a "Generate from Constellation" button that lists eligible engagements (those with the client's marketing-consent flag set on the Constellation side), a side-by-side view of the raw outcome data and the generated draft, and an inline diff editor so the editor can refine before promoting to `scheduled` / `published`. A small audit trail records which Constellation engagement seeded which case study, the prompt + model version used, and the human edits applied — giving us both lineage and a feedback loop to improve the prompt. Out of scope: auto-publishing without human review (always-draft is a deliberate constraint), pulling testimonials directly from clients (separate consent workflow). Follow-up: extend to Polaris episode show-notes once the Polaris production pipeline matures.

---

## Heterogeneous CMS Artifacts

### #108 · Bring the FAQ schema onto the shared artifact pattern
**Depends on:** #107 (FAQ → DB + JSON-LD FAQPage) — merged

#107 shipped with a bespoke `status: text` column instead of the shared `artifact_status` enum, and omits `deletedAt`, `unpublishedAt`, `active`, and `featured` / `featuredRank`. The deviation was deliberate (see `faq.ts` inline comment) and is low-stakes today, but it blocks cheap future asks like "hide this FAQ without deleting it", scheduled retirement, and type-safe status against typos. This task migrates `faq_categories` and `faq_items` onto `artifactIdentity` / `artifactLifecycle` / `artifactTimestamps` from `_artifactBase.ts`, updates `/api/faq` and the admin CRUD to use the shared visibility filter, and backfills existing rows so nothing flips to draft on migration. No public-surface change.

---

## Admin Access & People

### #109 · Careers / HR module under `/admin/people/careers`
**Depends on:** admin section reorganization (capability layer + section folders)

Today the admin has a `people` section that manages the team grid and events, but nothing for recruiting. This task adds a Careers module: DB tables for `job_postings` (title, slug, department, location, employment type, status, hero copy, responsibilities, requirements, compensation range, posted/closes timestamps) and `job_applications` (name, email, resume object-storage ref, cover letter, status `new|reviewing|interviewing|offer|hired|rejected|withdrawn`, applicant-supplied fields, timeline of status changes). Admin pages under `pages/admin/people/careers/` for list + edit of postings and a triage view of applications. Public pages at `/careers` and `/careers/:slug` with an apply form that uploads resumes through the existing Object Storage flow. Introduces an `hr` role and an `hr.manage` capability; the existing Careers admin items on the sidebar are gated on `hr.manage`. Transactional email confirmations reuse the Resend integration.

### #110 · Expand the user/role model to seven audience classes
**Depends on:** #109 (or any first work on audience-specific surfaces)

The current CMS has four roles (admin, editor, author, contributor) plus an allow-list flag. The product direction is seven audience classes: `anonymous`, `registered`, `customer`, `internal`, `content_author`, `hr`, `site_admin`. This task introduces the three new end-user classes (`registered`, `customer`, `internal`) alongside a renamed/split CMS side (`content_author` replaces the four-way split where appropriate, or stays granular if editorial workflow demands it — to be decided during implementation). Each class gets a clear list of capabilities. The client-side capability map in `artifacts/synozur/src/lib/capabilities.ts` gains entries for the new classes, and server-side guards learn to accept them. Note: this is a pure authorization-model change; it does not yet build customer-facing portals or internal dashboards — those are separate future tasks once this scaffolding lands.

### #111 · Move the role → capability map into the database
**Depends on:** #110

The capability map currently lives in `artifacts/synozur/src/lib/capabilities.ts` as a hand-edited `Record<RoleName, Capability[]>`. That's fine for today's four roles but will not scale once we're juggling seven audience classes, customer portal permissions, and per-tenant overrides. This task adds a `capabilities` table (`id`, `name`, `description`) and a `role_capabilities` join table, seeds both from the current static map, and switches `/api/auth/me` to return the user's effective capabilities so the client no longer has to recompute them. Admin UI under `/admin/access` gains a capability editor. Existing client code reads `access.capabilities` / `access.hasCapability()` unchanged — only the source of truth moves.

### #126 · Microsoft Entra SSO for employees and admins
**Depends on:** — (identity foundation; strongly paired with #127)

Authentication today goes through Clerk: `artifacts/synozur/src/main.tsx` wraps the app in `ClerkProvider`, `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` validates session JWTs, and `auth.ts` → `loadOrCreateUser(clerkUserId)` maps the Clerk user id to a row in `usersTable`. That's fine for public customers but employees and admins should sign in with their Synozur Entra identity so lifecycle (hire / leave / group membership) is governed in one place and MFA / conditional-access policies apply automatically. This task adds Entra ID (OIDC) as an Enterprise SSO connection on the Clerk side so `@synozur.com` email domains are routed to the Entra tenant at sign-in, then extends `loadOrCreateUser` to read the Entra group claims off the Clerk session and map them to the admin role table (e.g. `Synozur-Admins` group → `admin` role, `Synozur-Editors` → `editor`). The `allow-list` flag in the users schema gets backfilled from group membership at login so offboarding an Entra user instantly removes CMS access. Public sign-in UX unchanged; admins land on a branded "Continue with Microsoft" option. Follow-up: once #127 ships we can share the same Entra app registration for Graph API storage access and avoid a second credential set.

### #128 · Act as an OAuth 2.0 / OIDC provider for other Synozur web apps
**Depends on:** #110 (audience-class model) or can ship in parallel

This app owns the canonical `usersTable` plus the role/capability model; other Synozur web apps (current and future — customer portal, internal tools, partner dashboards) should not re-implement user management or rewire Entra separately. This task turns the api-server into an OAuth 2.0 authorization server with OIDC on top, so downstream apps redirect users here to sign in, receive ID + access + refresh tokens, and read user metadata via a `/oauth/userinfo` endpoint. Scope: new tables `oauth_clients` (`id`, `clientId`, `clientSecretHash`, `name`, `redirectUris jsonb`, `allowedScopes jsonb`, `allowedGrantTypes jsonb`, `createdBy`, timestamps) and `oauth_authorizations` (for authorization-code + refresh-token persistence); endpoints `GET /oauth/authorize`, `POST /oauth/token`, `GET /oauth/userinfo`, `GET /.well-known/openid-configuration`, `GET /.well-known/jwks.json`; a consent screen that shows the requesting app name + requested scopes; admin UI under `/admin/access/oauth-clients` to register / rotate credentials for downstream apps. Use RS256 with a rotating key pair stored in site settings (or a KMS once available). Scopes mirror the capability model so a consuming app can request only `profile content.read` without getting full admin. Authentication into the consent screen reuses whatever sign-in mechanism the user has (Clerk or Entra via #126) — this task just adds the token-issuing surface on top. Follow-up: publish a `@synozur/auth-sdk` helper package so downstream apps integrate in a handful of lines.

### #129 · Cross-app switcher (Constellation, Vega, Nebula, …) for signed-in users
**Depends on:** #128 (OAuth provider); pairs well with #110 (audience classes)

Once the api-server issues OIDC tokens for the wider Synozur app suite (Constellation at `scdp.synozur.com`, plus Vega / Nebula / Orion / Orbit / Zenith and the eventual Galaxy customer portal), authenticated users on this site need a single discoverable place to jump into whichever app they have access to — without re-authenticating and without each app maintaining its own list of siblings. This task adds an Office-365-style "waffle" **app switcher** in the top nav, rendered only for signed-in users. Entitlements are sourced from the OAuth provider: `/oauth/userinfo` is extended to return an `apps` claim — an array of `{ clientId, name, iconUrl, launchUrl, color }` objects derived from `oauth_clients` rows the user has been granted (via direct grant, role mapping, or audience-class default). The switcher fetches this list on session bootstrap, caches it for the session, and renders each entry as a tile linking to the app's launch URL with a short-lived `?login_hint` (or pre-fetched authorization code via the `prompt=none` flow against `/oauth/authorize`) so the destination app completes SSO without a visible interstitial. Scope on this side: extend `oauth_clients` with `displayName`, `iconAssetId`, `launchUrl`, `accentColor`, `sortOrder`, `visibility` (`always | when_entitled | hidden`); add `app_entitlements` (`userId | audienceClass`, `clientId`, `grantedAt`, `grantedBy`); admin UI under `/admin/access/oauth-clients` gains an "App switcher" tab to toggle visibility, reorder, and assign default entitlements per audience class; new component `artifacts/synozur/src/components/app-switcher/AppSwitcher.tsx` consumed by the authenticated nav. Logged-out visitors see today's public `/applications` gallery unchanged. Follow-up: publish a small client helper in `@synozur/auth-sdk` (#128 follow-up) so each downstream app can mount the same switcher with one import.

### #130 · Admin-controlled UX theme switcher (Baseline / Aurora / future themes)
**Depends on:** #128 (cross-app theming reach), #110/#111 (per-audience theming); can scaffold ahead of #128

Today the site renders a single design language — the cosmic North Star theme (violet #810FFB, dark surfaces, starfield motifs) — defined statically in Tailwind config and shared primitives across `artifacts/synozur` and the admin shell. There is no path for marketing to A/B-test a fresher look, no path for a customer-portal audience to see a calmer surface, and no way to keep visual parity with downstream apps that may evolve their own palettes. This task introduces a runtime **theming layer**: a `themes` table (`slug`, `name`, `description`, `tokens jsonb`, `status`, timestamps) where `tokens` holds the full set of CSS custom properties (color ramps, typography scale, radii, surface treatments, motion durations, gradient stops, image overlays); a `theme_assignments` table mapping a theme to a surface (`public_site`, `admin_shell`) and optionally to an audience class (`customer`, `partner`, `internal`, …) per #110/#111; and a `<ThemeProvider>` at the React root that resolves the active theme from `/api/site/theme/active` and injects the token bundle as CSS variables on `<html>`. Tailwind config is refactored so brand colors and surface tokens reference the CSS variables, so existing components pick up the new theme with no code change. Ships with two seeded themes — `baseline` (current cosmic look, exact parity) and `aurora` (richer aurora-borealis gradients, brighter teal/violet accents, more atmospheric layering, softer motion). Admin UI under `/admin/site/theme` lists themes with live preview thumbnails, supports duplicating a theme to author a new one, and exposes the surface/audience assignment matrix. Changes propagate without redeploy via the existing site-settings hot-reload channel. The active theme metadata (slug + token hash + accent color) is also exposed on `/oauth/userinfo` and on a public `/.well-known/synozur-theme.json` so OAuth-consuming apps reached via the cross-app switcher (#129) — Constellation and friends — can opt into co-branded rendering. Out of scope: per-user theme overrides and full visual editor (follow-up).

### #135 · Galaxy client portal — v0
**Depends on:** #110 (audience classes — specifically `customer`), #111 (DB-backed capability map), #128 (OAuth provider); strongly pairs with #127 (SPE storage for client deliverables)

The long-planned Galaxy client portal has been a roadmap concept for some time but has no shipped surface. This task lands a **thin v0** that gives existing clients a single authenticated home for their engagement with Synozur — turning the OAuth-provider work in #128 from infrastructure into a real product. Scope (deliberately small):
- New workspace `artifacts/galaxy` (Vite + React 19, reuses `lib/api-client-react`, the shared theming layer from #130, and the cross-app switcher from #129).
- Authentication via this site's OAuth provider (Galaxy is registered as an `oauth_client` with scopes `profile engagements.read deliverables.read invoices.read`).
- Three pages on launch: **Home** (greeting, account team contacts pulled from team data, list of active engagements), **Engagement detail** (status pulled live from Constellation via the API client added in #138, deliverables list from SPE container per #127, risks/milestones summary), **Documents** (read-only deliverable browser scoped to that client's container).
- Server side: extend api-server with `GET /portal/engagements`, `GET /portal/engagements/:id`, `GET /portal/documents/:id` — all guarded by the `customer` audience class plus a `clientId` claim that scopes results to the user's organization. New tables `client_organizations` (`id`, `name`, `slug`, `accountManagerUserId`, …) and `client_organization_users` (`userId`, `clientId`, `role`) own the client↔user mapping.
- Admin side: under `/admin/access/clients` (new) account managers create client-org records and invite users via email (Resend, #131/#132 for tracking).
- Out of scope for v0: invoice payment, ticketing/support inbox, file uploads from the client back to Synozur, SLA dashboards, multi-tenant white-labeling. These are explicit follow-ups once v0 is in customer hands.

This v0 is intentionally small enough to ship inside a quarter and concrete enough that #128's tokens get a real consumer beyond Constellation.

### #141 · Partner & co-marketing portal
**Depends on:** #110 (audience class `partner`), #111 (DB capability map), #128 (OAuth) — and reuses the workspace pattern from #135 (Galaxy)

`/partners` today is a logo wall plus contact CTA. This task promotes it to a logged-in **partner portal** for channel and alliance partners (Microsoft, technology ISVs, regional SIs), so the relationship has a working surface beyond email threads. Scope:
- New audience class `partner` (per #110) with capabilities `partner.dashboard`, `partner.collateral.read`, `partner.deal.register`, `partner.lead.submit`, `partner.mdf.request`.
- Either an `artifacts/partner-portal` workspace or a new authenticated section inside `artifacts/synozur` under `/partners/portal/*` (decision during implementation; the latter is faster to ship, the former scales better — pick after sizing real partner volume).
- **Co-branded landing-page generator**: pick a Synozur service or solution + add partner logo and partner-supplied copy → publish to a unique short URL that renders inside the existing site shell with the chosen theme (#130) and partner branding. Backed by a `partner_landing_pages` table.
- **Deal registration**: form captures opportunity (account name, est. value, close date, products of interest) and writes both a local `partner_deals` row and a HubSpot Deal (#131) attributed to the partner. Conflict check warns if Synozur already has an open opportunity in that account in the last N days (configurable).
- **Shared collateral library**: scoped view of `collateral` rows tagged `partner_visible`; no admin UI rebuild — just an additive `partnerVisible` column and a filter on `/api/partner/collateral`.
- **MDF (market development funds) requests**: form + admin triage queue under `/admin/partners/mdf` with status states `submitted | approved | rejected | paid`.
- **Lead handoff**: partners submit qualified leads into the same HubSpot pipeline as inbound forms, tagged with their partner id for attribution and any subsequent commission accounting.
- Onboarding: partner managers invite primary partner contacts from `/admin/partners/:id/users`; each invite seeds a `partner` audience-class user.

Out of scope: a full PRM (partner-relationship management) replacement, commission calculation, training/certification tracking. Follow-up: pipe partner-attributed deal stage transitions back into HubSpot timeline events for unified reporting.

---

## Marketing & Lifecycle

### #131 · HubSpot integration for lead capture and on-site activity
**Depends on:** — (can ship independently); pairs with #110 (audience classes) and #126 (Entra SSO) for cleaner contact mapping

The site captures prospect signal in many places — the contact form, newsletter subscribe, start-inquiry forms, comment submissions on Insights, eventually authenticated sign-ups via Clerk and Entra (#126) — and emits anonymous analytics to GA4 / LinkedIn / Meta pixels, but none of that lands in a CRM where sales and marketing can act on it. Today a lead who fills the contact form gets a Resend confirmation and an internal email, full stop; there is no Contact record, no lifecycle stage, no first-touch attribution, no timeline of what they read before they reached out. This task wires the api-server and the marketing site into **HubSpot** so every captured lead becomes a Contact and every meaningful interaction becomes a Timeline event on that contact.

Scope:
- **Server-side identity sync.** New module `artifacts/api-server/src/lib/hubspotSync.ts` that owns idempotent upsert into HubSpot (`/crm/v3/objects/contacts`) keyed by email, queue-backed with retry + dead-letter so a HubSpot outage doesn't drop submissions or block the form response. The existing form handlers (`/api/contact`, `/api/newsletter`, `/api/start-inquiry`, comment submission with email, the future Clerk/Entra sign-up webhook) call into this module fire-and-forget *after* the existing Resend confirmation is enqueued.
- **Activity timeline.** Define HubSpot custom timeline event types — `synozur_form_submitted`, `synozur_insight_viewed`, `synozur_application_demo_requested`, `synozur_polaris_chat_engaged`, `synozur_signed_in` — and emit them via `/crm/v3/timeline/{appId}/events`. High-intent events emit server-side (so they survive ad-blockers); page views and scroll-depth come from the HubSpot tracking script wrapped behind the existing cookie-consent gate.
- **Cookie consent + GDPR.** The HubSpot tracking script joins GA4 / LinkedIn / Meta in the consent gate. Server-side upserts honor a `marketing_opt_in` boolean captured on every form (default off in EU geos, default on elsewhere, configurable). A `/admin/integrations/hubspot/erasure` endpoint forwards GDPR delete requests to HubSpot's GDPR API.
- **UTM + first-touch attribution.** Capture `utm_source / medium / campaign / term / content` on first landing (already passed to analytics), persist in a first-party cookie, and write them onto the HubSpot contact's first-touch + last-touch properties on upsert.
- **Admin surface.** New page under `/admin/integrations/hubspot` shows connection status (private-app token health, last successful sync, queue depth, dead-letter count), per-form on/off toggles, the field → contact-property mapping table, an audience-class → lifecycle-stage mapping (e.g. `customer` → `Customer`, `partner` → `Other`, `registered` → `Subscriber`), and a recent-events log with replay action for debugging.
- **Configuration.** `HUBSPOT_ACCESS_TOKEN` (private app) and `HUBSPOT_PORTAL_ID` in env; mappings + per-form toggles live in site settings so non-engineers can tune them.

Out of scope: bidirectional sync (CRM → site enrichment), replacing Resend for marketing email sends, replacing GA4. Follow-up once #128 ships: write app entitlements (Constellation, Vega, etc.) onto the HubSpot contact as properties so account managers can see at-a-glance which apps a customer is licensed for; once #129 ships emit a `synozur_app_launched` timeline event whenever a user clicks through the cross-app switcher.

### #132 · SendGrid integration for marketing email and deliverability redundancy
**Depends on:** — (can ship independently); pairs with #131 (HubSpot lead capture)

Today all outbound mail — contact-form confirmations, newsletter double-opt-in, start-inquiry replies, comment moderation pings, scheduled-post notifications — goes through **Resend** via a thin client in `artifacts/api-server/src/lib/email/`. Resend is excellent for low-volume transactional flows but the roadmap brings two demands it isn't well-suited to: (a) larger marketing sends to the newsletter and Insights subscribers as the audience grows, and (b) deliverability redundancy so a single provider outage doesn't silently break sign-ups, password resets, and SSO invitations. This task adds **SendGrid** alongside Resend behind a provider abstraction, with an admin-controlled routing policy that picks the right provider per message class.

Scope:
- **Provider abstraction.** Refactor `artifacts/api-server/src/lib/email/` to an `EmailProvider` interface (`send(message)`, `sendBulk(messages)`, `addToList`, `removeFromList`, `getEvent(messageId)`). Keep the existing Resend driver, add a SendGrid driver over `/v3/mail/send` and `/v3/marketing/contacts`. Existing call sites (form handlers, comment moderation, scheduled-post worker) keep their current API surface unchanged.
- **Routing policy.** Site-settings rows hold a `messageClass → provider` map (`transactional` → Resend, `marketing` → SendGrid, `system` → Resend, `bulk_announcement` → SendGrid) plus a `failoverProvider` per class. The router applies the policy at send time; a provider failure (5xx, 429 with no retry-after success, timeout) automatically retries on the failover provider and emits a `email.failover_triggered` audit event so admins notice persistent issues.
- **Marketing list sync.** Newsletter subscribe and unsubscribe flows write to a SendGrid Marketing Contacts list (one list per audience class — `newsletter`, `insights_digest`, `event_invites`) in addition to the existing internal `subscribers` table. Unsubscribe webhooks from SendGrid (`/webhooks/sendgrid`) flip the local row to `unsubscribed` so the audit trail matches.
- **Event ingestion.** SendGrid Event Webhook (delivered, opened, clicked, bounced, dropped, spamreport, unsubscribe) hits a new `/webhooks/sendgrid/events` endpoint, signed-payload verified, and rows land in an `email_events` table keyed by message id. The same table accepts the equivalent Resend events so admins see a unified timeline regardless of provider. When #131 ships, opens/clicks on marketing sends also emit a `synozur_email_engaged` HubSpot timeline event.
- **Authentication & deliverability.** Document and script DNS for SPF, DKIM (per-provider selectors so both providers sign in parallel), and DMARC alignment in `docs/email-domain-verification.md`. Add a `/admin/integrations/email/health` page that pings each provider's domain auth status and surfaces deliverability KPIs (bounce rate, spam rate, IP/domain reputation when exposed by the provider).
- **Templates.** Migrate the existing Resend HTML templates into a shared `email-templates` package rendered by both drivers (MJML or plain Handlebars — pick during implementation), so the same template renders identically regardless of which provider sends it.
- **Configuration.** `SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_PUBLIC_KEY` in env; sender identity (`SYNOZUR_FROM_EMAIL`, `SYNOZUR_FROM_NAME`) shared across providers; per-message-class provider mapping editable under `/admin/integrations/email`.

Out of scope: replacing HubSpot's own marketing-email engine (HubSpot keeps its lifecycle nurtures), drag-and-drop visual template editor, list-of-lists segmentation UI. Follow-up: wire the `email_events` table into the contact's HubSpot timeline so sales sees a single engagement view across web activity (#131) and email engagement.

### #140 · Experimentation framework + conversion-funnel analytics
**Depends on:** — (additive); pairs with #131 (HubSpot identity) for funnel attribution and #130 (theme switcher) as a likely first experiment

The site is heavily instrumented for traffic (GA4, LinkedIn, Meta pixels) but has no first-party experimentation framework, no funnel view of how visitors move from landing → service → contact, and no way to A/B-test hero copy, CTA placement, or pricing surfaces with statistical rigor. Today every product/marketing change ships as a one-way hypothesis. This task adds:
- **Experiment definition + assignment.** Self-hosted GrowthBook (or PostHog if we want session replay alongside — decide during implementation). Experiments are defined in the admin UI under `/admin/marketing/experiments` with name, hypothesis, variants, traffic allocation, targeting (route, audience class, geo), primary metric, guardrail metrics. SDK on the client (`useExperiment(key)`) returns the assigned variant; assignment is sticky-by-anonymous-id pre-auth and sticky-by-user-id post-auth so visitors don't see flickering when they sign in.
- **Funnel definition.** Each experiment can attach to a named funnel — e.g. `landing → /services → /services/:slug → contact_form_submit`. Funnels are defined as sequences of GA4-mirrored events; the admin shows current conversion at each stage and per-variant lift with confidence intervals.
- **Server-side flag evaluation.** API routes can also flip behavior on flags (e.g. testing alternate Resend templates) so experiments aren't limited to UI variants.
- **Identity bridge.** When a visitor authenticates or submits a form, the anonymous experiment id is bridged to the HubSpot contact (#131) and becomes a contact property, so sales sees which variants the lead saw before converting.
- **Guardrails.** A small set of always-on guardrail metrics (page-load time, error rate, bounce rate) automatically halt experiments that regress beyond a threshold; halts post to the audit log and email the experiment owner.
- **Documentation.** A short experiment-design guide in `docs/experimentation.md` with templates for hypothesis writing, sample-size calculation, and a "kill criteria" checklist.

Out of scope: multi-armed bandits (start with frequentist A/B), causal-inference observational studies. Follow-up: wire experiment assignment into the cross-app switcher (#129) so we can A/B test Galaxy / portal entry points in one place.

---

## Public Site UX

### #133 · Constellation interactive demo sandbox on /applications/constellation
**Depends on:** — (additive on the public site); optional pairing with #128 (OAuth) if we eventually link the demo to a real free tier

The Constellation product page (`/applications/constellation`, sourced from `artifacts/synozur/src/data/applications.ts`) currently sells the AI Consulting Delivery Platform with copy + still images, the same way the other five apps are presented. For a delivery platform whose differentiator is the *feel* of AI-synthesized status reports and proactive risk surfaces, this is the weakest part of the funnel — prospects can't experience the product without booking a demo, and the demo bar is high. This task ships a **guided, sandboxed in-page demo** that lets a visitor experience three or four canonical Constellation moments without leaving the marketing site:
1. A realistic project dashboard (pre-seeded sample data — fake client, real-looking timelines, deliverables, risks).
2. The AI executive narrative ("here's what changed this week") rendered live, generated server-side from the seed data via Claude on first load and cached.
3. A risk drill-down that walks the visitor through how Constellation surfaces a slipping deliverable.
4. A simulated "send to Outlook" CTA that completes inline (no real email sent) so the visitor sees the Microsoft 365 integration story without auth.
Implementation: new `artifacts/synozur/src/components/demos/constellation/` module with a step-driven controller (URL-routable steps so we can deep-link from ads to a specific moment). Server-side: a small `/api/demos/constellation/narrative` endpoint that takes a seed id and returns a cached AI-generated narrative — keyed so we never regenerate per-visit. The interaction telemetry feeds into the experimentation framework (#140) and the HubSpot timeline (#131) — clicking through all four moments emits a high-intent `synozur_application_demo_requested` event with `app=constellation, depth=full`. Out of scope: a real free-tier login (still gated by the contact form), demos for the other five applications (apply the pattern in follow-up tasks once Constellation proves the format).

### #134 · "Ask Synozur" — RAG-powered Q&A across Insights, case studies, and white papers
**Depends on:** — (data is already in the CMS); pairs with #122 (multi-resource attachments give richer source material) and #131 (intent capture)

The site has accumulated a real corpus of editorial content — Insights posts, Polaris episode notes, white papers, case studies, FAQ — but visitors can only find it by browsing or search-by-title. They can't ask the corpus questions like "what does Synozur recommend for AI rollouts in financial services?" or "have you done a Constellation engagement in the public sector?" and get a grounded, cited answer. This task adds a **retrieval-augmented Q&A surface** on top of existing content. Scope:
- **Embeddings.** Add `pgvector` to the Postgres schema and an `embeddings` table (`source_kind`, `source_id`, `chunk_index`, `text`, `embedding vector(1536)`, `model_version`, `updated_at`); a backfill worker chunks every published Insights post, case study, white paper, FAQ entry, and Polaris show-notes row into ~500-token chunks and embeds them. Re-embedding triggers on publish/update (existing artifact lifecycle hooks make this clean).
- **Q&A endpoint.** `POST /api/insights/ask` takes a question + optional filter (audience class, sector tag, application tag), runs hybrid retrieval (vector + BM25 over `collateral.title/excerpt`), and produces a grounded answer via Claude with mandatory inline citations linking back to the source content. Refusal path returns a "we don't have published material on that — talk to a human?" CTA wired to the contact form.
- **Public surface.** New `/insights/ask` page with conversation history (session-scoped, not persisted unless the user authenticates) and per-answer source cards. Also embedded as a discovery widget on the Insights index page.
- **Editorial telemetry.** Every question + retrieved sources + final answer is logged (with PII redaction on the question) so editors can see what the audience is actually asking and what content gaps that surfaces. Admin page under `/admin/insights/questions` shows the top questions, click-through to sources, refusal rate, and a "create insight on this topic" shortcut.

Out of scope: open-ended chat memory across sessions, fine-tuning, multi-language Q&A (English first; revisit after #139). Follow-up: pipe high-intent questions ("how do I buy / start") to the Polaris concierge in #137 for a soft hand-off.

### #136 · Interactive maturity assessment replacing the static service-pillar pages
**Depends on:** — (CMS additive); pairs with #131 (lead capture into HubSpot) and #138 (case-study seeding)

The four service pillars today are essentially brochure pages — well-written but passive, and they convert via the same generic contact form as every other page. This task replaces (or augments — a/b test it) the pillar pages with an **interactive maturity assessment**. A visitor answers 10–14 questions across themes (AI readiness, delivery maturity, data foundation, change-management posture, technical debt) and gets:
- A scored maturity profile per dimension with a clear narrative.
- A personalized roadmap recommending specific Synozur services (mapped from the existing `services` table), solutions (mapped from `solutions`), and applications (Constellation, Vega, etc.) — with cited reasoning per recommendation.
- A downloadable PDF report (rendered server-side) the visitor can email to themselves and share internally.
- Optional contact-handoff to a real conversation, with the assessment results pre-populated into the contact-form payload and written through to HubSpot (#131) as contact properties + a `synozur_assessment_completed` timeline event.
Implementation: new tables `assessments` (`id`, `slug`, `version`, `published`), `assessment_questions` (`id`, `assessmentId`, `text`, `dimension`, `weights jsonb`, `sortOrder`), `assessment_responses` (anonymous + authenticated, with pii flag), `assessment_recommendations` (mapping from score profiles to services/solutions/applications). Admin UI under `/admin/marketing/assessments` lets non-engineers author new assessments, edit recommendations, and version them. Public surface at `/assessments/:slug` with a polished step-by-step UI. Out of scope: gamified scoring, multi-user team assessments (single-respondent only for v1), CRM-side scoring sync. Follow-up: surface the assessment as the primary CTA on the home page once we've validated conversion vs. the existing contact form.

### #137 · Polaris AI concierge — site-wide chat assistant
**Depends on:** #134 (reuses the embeddings + Q&A pipeline as its retrieval layer); pairs with #131 (handoff to humans), #136 (deep-link into the assessment)

The site has the **Polaris** brand (a podcast about transformation and the eponymous "north star" cosmic motif) — a natural fit for a conversational concierge. This task adds a persistent chat widget, branded as "Polaris," that helps visitors navigate the site and answers questions on the spot. Scope:
- Floating chat button in the lower-right of every public page (and inside the Galaxy portal once #135 ships, with deeper context).
- Backed by Claude with three tool integrations: (a) the Q&A retrieval layer from #134 for content questions; (b) a `bookMeeting` tool that surfaces a Calendly-style scheduler; (c) a `submitContactForm` tool that fills the existing contact form on the visitor's behalf with their permission.
- Streaming responses with markdown + source-card rendering identical to the Q&A page.
- Strict guardrails: refuse pricing speculation, refuse to commit Synozur to delivery, hand off to a human via the contact form whenever the visitor explicitly asks for one or the model's confidence drops.
- Cookie-consent gated; conversation transcripts (with PII redaction) saved when the visitor consents and surfaced to admins under `/admin/marketing/concierge` for review and content-gap mining.
- Rate-limited per IP and per session; abuse triggers a captcha and then a soft block.

Out of scope: voice mode, multi-language responses (#139 follow-up), agentic actions beyond the three tools above. Follow-up: integrate the assessment (#136) so Polaris can steer relevant visitors into the assessment flow.

### #139 · Internationalization foundation (English baseline + one launch locale)
**Depends on:** — (architecture); pairs with #110 (some audience classes will skew geographically), #130 (theme assets may need locale variants)

Every public string and every editorial CMS field on the site is English-only today. Enterprise procurement in EU and APAC stalls on this even when the buying team speaks English. This task lays the **i18n foundation** without trying to translate the entire corpus on day one:
- **Code-side i18n.** Adopt FormatJS (`react-intl`) inside `artifacts/synozur` with a build-time message-extraction step. Every string in the codebase moves to a `messages` catalog keyed by namespace; `en` is the baseline. Locale-routed URLs (`/de/insights/...`, `/ja/applications/constellation`) with a transparent default for `en` to avoid breaking existing links.
- **Content-side i18n.** Add a `locale` column + per-locale row strategy for translatable artifact fields on `collateral`, `services`, `solutions`, `case_studies`, `faq_items` — keyed (`canonicalId`, `locale`). The base row in `en` is canonical; per-locale rows are translations linked back. Admin UI gains a language switcher per editable field with a visible "translation lag" indicator (e.g. "EN updated 3 days after this DE translation").
- **Locale negotiation.** `Accept-Language` + explicit selector + persisted user preference (in `users.preferredLocale` for authenticated users, in localStorage for anon).
- **One launch locale.** Pick one (de or ja) for the first translation pass — translate the 30 highest-traffic public pages plus the four service pillars and the six application pages.
- **Translation workflow.** Integrate with Crowdin or Lokalise (decide during implementation) so external translators work in their native tooling rather than the admin UI; CI exports updated `messages.en.json`, fetches translated bundles, and writes them into `artifacts/synozur/src/locales/`.

Out of scope: right-to-left languages (separate pass), region-specific content (different case studies per locale — possible but not v1), multi-currency pricing. Follow-up: localize the Polaris concierge (#137) and the Insights Q&A (#134) once the editorial corpus has enough translated content to retrieve from.

---

## Quality & Compliance

### #142 · Accessibility & Core Web Vitals compliance dashboard
**Depends on:** — (additive); pairs with #57 (Playwright tests are the natural place to wire axe-core)

Enterprise procurement (especially public-sector and EU) increasingly requires VPATs and WCAG 2.2 AA conformance, and Core Web Vitals (CWV) directly affect search rank and perceived quality. The site is in reasonable shape today but there's no continuous signal — accessibility regressions and performance regressions only surface when someone notices visually. This task institutes **continuous quality measurement** with three layers:
- **Pre-merge.** Add Lighthouse CI to the existing CI pipeline running against a representative set of routes (home, insights index, an insight detail, a service detail, an application detail, contact). Performance, accessibility, best-practices, and SEO scores all fail the build below configurable thresholds. Add `@axe-core/playwright` into the Playwright suite from #57 so accessibility violations on critical user paths are caught at PR time.
- **Authoring time.** Hook the existing image-upload flow (`assets` + library admin) to require non-empty `alt` text on `<img>` uploads marked `decorative=false`, with admin-side preview of the alt text in context. Heading-order linting on rich-text editors (a `published` post can't have an H4 before any H3). FAQ + collateral admin gain inline a11y warnings (color-contrast on hero overlays, link-text quality).
- **Run-time.** Integrate `web-vitals` reporting from real visitors to a new `cwv_samples` table via `/api/metrics/cwv`, sampled and aggregated by route. Admin dashboard at `/admin/site/health` shows: WCAG conformance status per template (from the latest CI axe run), CWV percentiles per top route, alt-text coverage, broken-link count, redirect chain health (uses the existing `redirects` table), and trend lines.
- **Gate.** Critical (severity ≥ "serious") axe violations or LCP > 4s p75 on a public template flip a flag that prevents `published` state on artifacts of that template until cleared, surfacing the issue as a CMS validation error to the editor. Override available with audit trail.

Out of scope: VPAT generation (separate effort with legal), automated remediation (suggestions only), continuous synthetic monitoring beyond Lighthouse CI. Follow-up: publish the public site's accessibility statement page and link from the footer.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| #57 | Playwright tests for services pages | QA | #40 |
| #62 | Bulk CSV import for services & solutions | Services admin | #39 |
| #68 | Auto-trim old post revisions | CMS | #48 |
| #108 | FAQ schema onto the shared artifact pattern | Heterogeneous CMS | #107 |
| #109 | Careers / HR module under /admin/people/careers | Admin Access & People | — |
| #110 | Expand user/role model to seven audience classes | Admin Access & People | #109 |
| #111 | Move role → capability map into the database | Admin Access & People | #110 |
| #120 | Carousel manager as its own admin tab (thumbnail + type views) | Library | #118 |
| #121 | Sortable columns on the collateral library admin list | Library | #69 |
| #122 | Multiple resource attachments on library items | Library | #63 |
| #126 | Microsoft Entra SSO for employees and admins | Admin Access & People | — |
| #127 | Migrate asset storage from GCS to SharePoint Embedded | Library / Infra | — |
| #128 | OAuth 2.0 / OIDC provider for other Synozur web apps | Admin Access & People | #110 |
| #129 | Cross-app switcher (Constellation, Vega, …) for signed-in users | Admin Access & People | #128 |
| #130 | Admin-controlled UX theme switcher (Baseline / Aurora / …) | Admin Access & People | #128, #110 |
| #131 | HubSpot integration for lead capture and on-site activity | Marketing & Lifecycle | — |
| #132 | SendGrid integration for marketing email and deliverability redundancy | Marketing & Lifecycle | — |
| #133 | Constellation interactive demo sandbox on /applications/constellation | Public Site UX | — |
| #134 | "Ask Synozur" RAG-powered Q&A across editorial content | Public Site UX | — |
| #135 | Galaxy client portal — v0 | Admin Access & People | #110, #111, #128 |
| #136 | Interactive maturity assessment replacing static service-pillar pages | Public Site UX | — |
| #137 | Polaris AI concierge — site-wide chat assistant | Public Site UX | #134 |
| #138 | Programmatic case-study drafts from Constellation outcomes | Content Library | #128 |
| #139 | Internationalization foundation (English + one launch locale) | Public Site UX | — |
| #140 | Experimentation framework + conversion-funnel analytics | Marketing & Lifecycle | — |
| #141 | Partner & co-marketing portal | Admin Access & People | #110, #111, #128 |
| #142 | Accessibility & Core Web Vitals compliance dashboard | Quality & Compliance | — |
