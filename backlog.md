# Synozur Alliance — Product Backlog

> Last updated: May 1, 2026  
> 47 tracked tasks · 3 strategic roadmap items · 110 merged · 30 cancelled

Tasks are grouped by theme. Entries with a `#` ref correspond to project task system records (PROPOSED or active). Entries in the **Strategic Roadmap** section are planned future initiatives that do not yet have a project task record. Items shown with strike-through were verified as already shipped during the May 2026 SEO audit pass and are kept here only until the next merged-tasks rollover.

## 🚦 Launch Readiness — Pre-Production Gate

Locked in May 2026 as the gating checklist for the public launch of `synozur.com`. Items in **Tier 1** must close before public launch; Tier 2 must close before any external announcement / SEM spend; Tier 3 can ship in week 1 post-launch.

Each row links to the canonical backlog entry below where the implementation detail lives. This section is the single source of truth for go/no-go status — update the checkbox as items close.

### Tier 1 — Critical, must ship before public launch

- [ ] **L1. Production auth cutover** → BACKLOG.md "Clerk removal cleanup" #1, #2, #3.
  Run `pnpm --filter @workspace/db run push` in staging then production; provision the Entra app registration per environment (redirect URIs, `User.Read` delegated + `GroupMember.Read.All` application permissions with admin consent, `synozur.com` domain claim hint); set `ENTRA_TENANT_ID`, `ENTRA_APP_CLIENT_ID`, `AUTH_REDIRECT_URI`, `ENTRA_APP_CLIENT_SECRET` in each env's secret store; purge legacy `CLERK_*` env vars. **Blocks every signed-in flow.**
- [ ] **L2. Search Console + Bing Webmaster verification** → #160.
  Add `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` to `index.html` keyed off env vars; confirm DNS TXT record at the registrar; submit the sitemap manually for the first crawl. **Blocks organic discoverability — the site is invisible to Google until verified.**
  **Code shipped:** the SPA server (`artifacts/synozur/server.mjs`) splices both meta tags into the bare HTML response from `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` env vars at boot. The new `/admin/site-config/launch-readiness` page surfaces the live env-var state per channel so an admin can verify configuration without grepping startup logs. **Remaining ops:** set those two env vars in production, confirm DNS TXT, and submit the sitemap from each console.
- [ ] **L3. Live IndexNow / Google Indexing / Bing Webmaster credentials** → #102.
  Set `INDEXNOW_KEY` (and serve `/{key}.txt`), `GOOGLE_INDEXING_SA_JSON` (service account), `BING_API_KEY`, `BING_SITE_URL` in production; verify a test publish triggers a real submission. **Without these, every submit returns `ok: false` and new content waits days for organic discovery.**
  **Code shipped:** all three submission channels are implemented in `artifacts/api-server/src/lib/seoSubmit.ts`; the api-server logs each channel's status at boot under the `launch-readiness: L3 SEO submission` prefix, and the new `/admin/site-config/launch-readiness` admin page exposes the same per-channel status as JSON via `GET /api/cms/launch-readiness`. **Remaining ops:** set the four env vars and verify a test publish.
- [ ] **L4. Security headers via `helmet`** → #155.
  Ship CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Roll out CSP as `Content-Security-Policy-Report-Only` for ≥ 7 days against production traffic before enforcing (per BACKLOG.md "SEO & web-platform debt" #1). **Required by enterprise procurement reviews and pen tests.**
  **Code shipped:** helmet wired in `artifacts/api-server/src/lib/securityHeaders.ts` (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) and the same headers applied to public HTML responses in `artifacts/synozur/server.mjs`; CSP defaults to `Content-Security-Policy-Report-Only` and posts violations to `POST /api/csp/report` (`artifacts/api-server/src/routes/csp.ts`), which dedups them into the new `csp_violations` table; admin dashboard at `/admin/site-config/csp-violations` lets operators filter by directive, see hit counts and last-seen timestamps, and delete resolved rows. The dashboard now also surfaces an enforce-readiness verdict (`ready` / `monitoring` / `blocked` / `no-data`) backed by `GET /api/cms/csp/readiness`, computed from the days-since-last-violation against a 7-day clean window. **Remaining ops:** wait for the readiness banner to flip to `ready`, then set `CSP_ENFORCE=1`.
- [ ] **L5. Production GA4 + pixel IDs + privacy review.**
  Confirm `VITE_GA4_ID` (or DB override `tagGa4Id`) is the production tag, plus the LinkedIn and Meta pixel IDs in site settings. Re-read `/privacy` against the actual tag set so the listing matches reality. Cookie-consent gating is already correct, but a wrong tag ID silently drops every conversion event. **Blocks attribution from day one.**
  **Code verified:** the privacy page at `artifacts/synozur/src/pages/privacy.tsx` already enumerates GA4, LinkedIn Insight Tag, and Meta Pixel — matching the loader in `components/analytics.tsx`. The api-server logs whether each tag ID is configured (DB or env) at boot under the `launch-readiness: L5 marketing tag` prefix; the new `/admin/site-config/launch-readiness` page renders the same per-tag status. **Remaining ops:** populate `tagGa4Id` / `tagLinkedinPartnerId` / `tagMetaPixelId` in the admin SEO page, OR set the `VITE_*` env-var fallbacks.
- [ ] **L6. Wix-redirect production sweep** → #84 residual.
  Pull the top 100 not-found URLs from `not_found_logs` after staging traffic; confirm no high-traffic legacy URL is missing a redirect rule. Better to do this once before launch than to lose two weeks of crawl budget. **Last-mile cleanup on already-shipped infrastructure.**
- [ ] **L7. Backfill per-page OG / SEO data on production artifacts** → #86 residual.
  The OG-serving infrastructure is shipped, but `seoTitle`, `seoDescription`, and `ogImage` are blank on most production artifact rows, so every shared link previews with the same global default. **Code shipped:** `artifacts/api-server/src/scripts/runSeoBackfill.ts` wraps the existing `runAudit()` + `applyAutofill()` helpers and is the operational entry point — dry-run by default, prints per-kind totals + per-(kind, missing-field) counts, and only fills empty columns when `--apply` is passed. Run `pnpm --filter @workspace/api-server exec tsx src/scripts/runSeoBackfill.ts` in production for a dry-run, then `… -- --apply` once editorial signs off on the suggestions; `--kinds=insight,case-study,…` restricts the operation to specific artifact types. For `ogImage` specifically: kind-specific defaults in `site_settings` and #161 (dynamic OG image generation) remain follow-ups; for now the autofill leaves `ogImage` to fall back through the bot middleware to the global `seoDefaultOgImageUrl`. **Without this, social shares look generic regardless of which page was shared — a real visible regression compared to bespoke OG cards.**

### Tier 2 — Strongly recommended, ship before announcing

- [x] **L8. Akismet production key** → #152 residual. **Shipped May 2026.**
  `AKISMET_API_KEY` is provisioned (verified `valid` against `rest.akismet.com/1.1/verify-key`) and the comment-check round-trip was confirmed end-to-end with the documented `viagra-test-123` always-spam pattern (lands as `status=spam` with `spam_signals=["akismet"]`) and a ham control (lands as `status=pending`). Rule-based fallback still kicks in when Akismet is unavailable (timeout / error / `invalid`).
- [ ] **L9. Auth + rate-limit smoke tests in CI** → #119, #144.
  Sign-in Playwright test exercising `/sign-in → Entra → /callback → /api/auth/me`, plus a test that confirms the registration endpoint returns 429 above the rate-limit threshold. Both protect surfaces that will get probed within hours of launch.
  **Code shipped (sign-in tier):** `artifacts/synozur/tests/sign-in.spec.ts` (PR #71) covers (a) always-on render assertions on `/sign-in` plus a verified redirect from the Entra button to `login.microsoftonline.com` with `client_id` and `code_challenge` query params asserted, and (b) a full `/sign-in → Entra → /callback → /api/auth/me` round-trip gated on `E2E_ENTRA_TEST_USER_EMAIL` + `E2E_ENTRA_TEST_USER_PASSWORD` env vars so CI doesn't require an Entra test tenant by default. **Remaining gap:** provision those two secrets for the CI environment to unlock the full round-trip; the rate-limit (429) test is not yet written.
- [ ] **L10. PR-blocking Lighthouse CI** → #156.
  Move `lhci autorun` from `workflow_dispatch` into the standard PR job and bump perf/SEO assertions from `warn` to `error` for routes that already pass cleanly. Pairs with BACKLOG.md "SEO & web-platform debt" #2. Without this, post-launch perf regressions ship invisibly.
- [ ] **L11. PWA manifest + `theme-color`** → #154.
  Required for the iOS Safari "Add to Home Screen" experience and for the Lighthouse PWA audit to score above zero. Disproportionate quality signal for the effort (≈1 hour).

### Tier 3 — Polish, can ship in week 1 post-launch

- [ ] **L12.** `eslint-plugin-jsx-a11y` author-time a11y gate → #158.
- [ ] **L13.** 410 Gone / 308 Permanent Redirect for unpublished content → #162.
- [ ] **L14.** Dynamic OG image generation for editorial content → #161.
- [x] ~~**L15.** Honor `prefers-color-scheme` for first-time visitors → #165.~~ **Shipped May 2026.**
- [ ] **L16.** Share rail on insight / case-study / white-paper detail pages → #164.
- [ ] **L17.** Quality-gates warn → block flip → BACKLOG.md "Quality gates" #3, #4 (once warn-mode metrics are clean).
- [ ] **L18.** Robots meta + discovery-friendly 404 page → #163.
- [ ] **L19.** Expanded JSON-LD coverage (LocalBusiness, Person, Review, VideoObject) → #159.
- [ ] **L20.** CI broken-link checker → #157.

### Owner / cadence

- **Owner:** to be assigned at the launch-readiness kickoff. Editorial owns L7 (OG/SEO copy backfill); the marketing-engineering pair owns L2 / L3 / L5 / L8; platform owns L1 / L4 / L10; QA owns L6 / L9.
- **Cadence:** review this section in the weekly launch standup; flip checkboxes as items close. **Tier 1 must be 7/7 green before the marketing site DNS cut-over.**
- **Definition of done:** an item closes only when the code is in `main`, the configuration is applied to production, and a manual smoke test against the production URL confirms behavior. Code-only or staging-only completion does not count for launch-gate purposes.

---

### Already shipped (recorded so they aren't re-proposed)

The May 2026 audit cross-checked five frequently-suggested editorial enhancements against the codebase. Three are fully shipped — record them here so future intake passes don't re-file them as new work:

- **Estimated reading time on Insights posts** — `posts.readingTimeMin` column populated on seed via `Math.round(words / 200)` in `artifacts/api-server/src/scripts/seedPosts.ts`; surfaced on the article page at `artifacts/synozur/src/pages/insight-detail.tsx:226` ("X min read"); editable per post via `routes/cms/posts.ts`.
- **Related content recommendations on article and case-study pages** — `RelatedRail` component in `artifacts/synozur/src/pages/insight-detail.tsx` (3-up grid, filters out the current post), `relatedQ` in `artifacts/synozur/src/pages/case-study-detail.tsx` (2-up rail), and a generic `components/related-content.tsx` for service- and solution-scoped library views.
- **RSS / Atom feed for Insights** — `GET /api/insights/rss.xml` at `artifacts/api-server/src/routes/insights.ts:93` (RSS 2.0 with `atom:link rel="self"`, `content:encoded`, `dc:creator`, `pubDate`). Polaris also has its own iTunes-namespaced podcast feed at `/api/polaris/rss.xml` aliased to `/polaris/rss.xml`.

The remaining two ("social sharing buttons" and "dark mode") are partially shipped — see #164 (extend the event-detail share rail to editorial pages) and #165 (honor `prefers-color-scheme`) below.

---

## Content Library

### ~~#56 · Let editors manage services and solutions in the admin~~ **— Shipped**
**Depends on:** #40 (services hierarchy backend)

~~The services hierarchy lives in the database but can only be updated by re-running an ingest script — editors have no admin UI to manage it.~~ **Shipped:** the admin shell now ships full CRUD under `/admin/products/` — `services-list.tsx`, `service-edit.tsx`, `service-methodologies.tsx`, `solutions-list.tsx`, `solution-edit.tsx`, and `solution-capabilities.tsx`. (Note: the route prefix landed as `/admin/products/` rather than `/admin/services/` to match the broader `applications` / `case-studies` / `models` admin grouping.) Drag-to-reorder for methodology and capability blocks, TipTap rich text, and role-gated writes are all in place. Verified May 2026.

### #60 · Preview services and solutions before publishing
**Depends on:** #39 (services public pages), #56 (services admin UI)

Editors can update service pillars, solutions, and methodology or capability blocks in the admin, but there is no way to see how those changes will render on the public site before saving. This task adds a preview mode: a button in the admin editor opens the corresponding public page in a sandboxed state that renders the current unsaved form values without affecting what live visitors see.

### #61 · Track edit history for services and solutions
**Depends on:** #39 (services public pages), #56 (services admin UI)

The Insights CMS stores a revision snapshot on every save so content can be restored. Services, solutions, methodology blocks, and capability blocks have no equivalent — once an edit is saved the previous version is gone. This task extends the revisions system to cover the entire services hierarchy and adds a revision history panel with restore support to the admin editor.

### #66 · Preview a revision's content before restoring it
**Depends on:** #48 (post revisions)

The revision history panel lists past versions and lets authors restore them, but authors cannot see what a revision actually contains before committing to the restore. This task adds an inline preview: a modal or side panel that renders the snapshot's title, excerpt, and body alongside the live version so authors can read the content before deciding whether to restore.

### #67 · Show a diff between the current version and a past revision
**Depends on:** #48 (post revisions)

When authors are considering restoring a revision they often want to know exactly what changed, not just see the full snapshot. This task adds a side-by-side or inline diff view in the revision history panel that highlights added and removed text in each field between the selected revision and the current live version.

### #68 · Automatically trim old revisions to keep storage lean
**Depends on:** #48 (post revisions)

Every save creates a new revision. Without a retention policy, the `post_revisions` table grows indefinitely. This task adds a scheduled job (daily cron) that deletes revisions older than 90 days, keeping the 10 most recent regardless of age. The retention window and keep-count should be configurable via admin site settings.

### #75 · Bulk reorder featured library items via drag-and-drop
**Depends on:** #69 (collateral library admin)

Editors can mark collateral items as featured and set a numeric rank to control the order in the home carousel, but adjusting many items requires editing each rank by hand one at a time. This task adds a drag-and-drop reorder screen that lets editors grab and rearrange featured items visually, saving the new order in a single bulk operation.

### #76 · Show a live preview of how a library item will appear on the public site
**Depends on:** #69 (collateral library admin)

Editors filling out collateral fields have to navigate away to the public Library page or home carousel to see how the item renders. This task adds an inline preview panel to the collateral editor that shows a faithful replica of the public card and carousel tile as the editor updates fields, without requiring a page navigation.

### #151 · Show spam comment count badge on the moderation navigation item
**Depends on:** #54 (Insights comments)

The spam moderation tab is functional but there is no visual indicator in the admin sidebar that spam comments are waiting for review. Moderators have to navigate to the tab to discover whether there is pending work. This task adds a count badge to the moderation nav item that shows the number of unreviewed spam-flagged comments so the backlog is visible at a glance.

### ~~#152 · Add Akismet integration to catch more spam automatically~~ **— Shipped May 2026**
**Depends on:** #54 (Insights comments)

~~The current spam scorer uses rule-based heuristics — link count, keyword list, domain blocklist.~~ **Shipped:** `checkAkismet` in `artifacts/api-server/src/lib/spamScorer.ts` is fully wired (HTTP POST, 5 s timeout, graceful fallback) and now also captures Akismet's `X-akismet-pro-tip: discard` header (surfaced as the `akismet-discard` signal in the moderation UI), handles the `invalid` response by logging the `X-akismet-debug-help` reason, and exposes a `verifyAkismetKey()` helper that calls `rest.akismet.com/1.1/verify-key`. `AKISMET_API_KEY` is provisioned and was verified `valid`. End-to-end check on a real published post confirmed the documented `viagra-test-123` always-spam payload lands as `status=spam` with `spam_signals=["akismet"]`, while a control ham comment lands as `status=pending`. Rule-based scoring still runs in parallel and remains the sole signal source when the Akismet call returns `null` (timeout / network error / `invalid`).

### #153 · Make the spam rules settings page accessible to end-to-end automated testing
**Depends on:** #54 (Insights comments)

The admin area uses Entra SSO exclusively so the Playwright test runner cannot sign in programmatically to reach the spam rules settings page. The link threshold, keyword list, and domain blocklist UI in site-settings.tsx was manually verified to compile but has no automated test coverage. This task adds a test-environment auth bypass (strictly gated on `NODE_ENV=test`) and adds the missing Playwright tests for the save and remove interactions.

---

## Admin Access & People

### ~~#57 · Verify the new services pages with automated browser tests~~ **— Shipped**
**Depends on:** #40 (services hierarchy backend + public pages)

~~The pillar overview, per-pillar overview, service-detail, and solution-detail pages were built and manually verified but have no automated test coverage.~~ **Shipped:** Playwright suite at `artifacts/synozur/tests/services.spec.ts` covers the full flow — overview → pillar → solution detail with API assertions. Runs in the manual-trigger `quality.yml` workflow alongside the axe a11y suite (`a11y.spec.ts`). Verified May 2026.

### #109 · Careers / HR module under `/admin/people/careers`
**Depends on:** admin section reorganization (capability layer + section folders)

Today the admin has a `people` section that manages the team grid and events, but nothing for recruiting. This task adds a Careers module: DB tables for `job_postings` (title, slug, department, location, employment type, status, hero copy, responsibilities, requirements, compensation range, posted/closes timestamps) and `job_applications` (name, email, resume object-storage ref, cover letter, status `new|reviewing|interviewing|offer|hired|rejected|withdrawn`, applicant-supplied fields, timeline of status changes). Admin pages under `pages/admin/people/careers/` for list + edit of postings and a triage view of applications. Public pages at `/careers` and `/careers/:slug` with an apply form that uploads resumes through the existing Object Storage flow. Introduces an `hr` role and an `hr.manage` capability; the existing Careers admin items on the sidebar are gated on `hr.manage`. Transactional email confirmations reuse the Resend integration.

### #110 · Show a video thumbnail preview when a custom hero video is active
**Depends on:** #106 (hero video background)

When an admin sets a custom hero background video via site settings the page shows only a generic video icon with "Custom video" text — there is no visual confirmation of which video is loaded. This task adds a thumbnail preview in the site settings form that shows either a poster frame extracted on upload or a short muted clip of the active hero video, so admins can confirm the right file is in use without leaving the page.

### #111 · Validate video uploads before they reach object storage
**Depends on:** #106 (hero video background)

The current video upload path accepts any `video/*` MIME type up to 500 MB with no server-side validation of actual file contents. A caller could bypass the MIME check or upload a corrupt or unsupported file (for example, AV1 in MKV) that browsers will not autoplay. This task adds lightweight server-side validation of the real codec, container format, and duration before the file is persisted, and returns a clear error message if the upload fails validation.

### #119 · Add automated browser tests for the full sign-in and sign-out flow
**Depends on:** #115 (sign-in / session management)

The sign-in page works correctly today, but there are no automated tests covering the complete happy path from the public site through authentication and back. This task adds Playwright end-to-end tests for sign-in, the authenticated admin shell, and sign-out, using a test-environment auth bypass so the test runner can reach the admin without real Entra credentials.

### #128 · Act as an OAuth 2.0 / OIDC provider for other Synozur web apps
**Depends on:** #110 (audience-class model) or can ship in parallel

This app owns the canonical `usersTable` plus the role/capability model; other Synozur web apps (current and future — customer portal, internal tools, partner dashboards) should not re-implement user management or rewire Entra separately. This task turns the api-server into an OAuth 2.0 authorization server with OIDC on top, so downstream apps redirect users here to sign in, receive ID + access + refresh tokens, and read user metadata via a `/oauth/userinfo` endpoint. Scope: new tables `oauth_clients` (`id`, `clientId`, `clientSecretHash`, `name`, `redirectUris jsonb`, `allowedScopes jsonb`, `allowedGrantTypes jsonb`, `createdBy`, timestamps) and `oauth_authorizations` (for authorization-code + refresh-token persistence); endpoints `GET /oauth/authorize`, `POST /oauth/token`, `GET /oauth/userinfo`, `GET /.well-known/openid-configuration`, `GET /.well-known/jwks.json`; a consent screen that shows the requesting app name + requested scopes; admin UI under `/admin/access/oauth-clients` to register / rotate credentials for downstream apps. Use RS256 with a rotating key pair stored in site settings (or a KMS once available). Scopes mirror the capability model so a consuming app can request only `profile content.read` without getting full admin. Authentication into the consent screen reuses whatever sign-in mechanism the user has (Clerk or Entra via #126) — this task just adds the token-issuing surface on top. Follow-up: publish a `@synozur/auth-sdk` helper package so downstream apps integrate in a handful of lines.

### #129 · Cross-app switcher (Constellation, Vega, …) for signed-in users
**Depends on:** #128 (OAuth provider)

Signed-in users who work across multiple Synozur applications (this site, Constellation, Galaxy, and future apps) currently navigate between them by manually typing URLs. This task adds a persistent app-switcher UI element for authenticated users that lists every registered OAuth client the current user has access to, with one-click navigation and instant single-sign-on via the OAuth provider.

### #130 · Admin-controlled UX theme switcher (Baseline / Aurora / …)
**Depends on:** #128 (OAuth provider), #110 (audience-class model)

The site has a single fixed visual theme today. This task adds an admin-controlled mechanism to switch between defined theme presets (for example, Baseline and Aurora) without a code deploy. The active theme is stored in site settings, applied globally via CSS custom properties, and propagated to all registered OAuth client apps through the cross-app theme token so every Synozur surface stays visually consistent.

### #135 · Galaxy client portal — v0
**Depends on:** #110 (audience classes — specifically `customer`), #111 (DB-backed capability map), #128 (OAuth provider). SPE storage backend (#127) already shipped — the client-deliverables document browser plugs straight into the existing SPE container layer.

The long-planned Galaxy client portal has been a roadmap concept for some time but has no shipped surface. This task lands a **thin v0** that gives existing clients a single authenticated home for their engagement with Synozur — turning the OAuth-provider work in #128 from infrastructure into a real product. Scope (deliberately small):
- New workspace `artifacts/galaxy` (Vite + React 19, reuses `lib/api-client-react`, the shared theming layer from #130, and the cross-app switcher from #129).
- Authentication via this site's OAuth provider (Galaxy is registered as an `oauth_client` with scopes `profile engagements.read deliverables.read invoices.read`).
- Three pages on launch: **Home** (greeting, account team contacts pulled from team data, list of active engagements), **Engagement detail** (status pulled live from Constellation via the API client, deliverables list from SPE container, risks/milestones summary), **Documents** (read-only deliverable browser scoped to that client's container).
- Server side: extend api-server with `GET /portal/engagements`, `GET /portal/engagements/:id`, `GET /portal/documents/:id` — all guarded by the `customer` audience class plus a `clientId` claim that scopes results to the user's organization. New tables `client_organizations` (`id`, `name`, `slug`, `accountManagerUserId`, …) and `client_organization_users` (`userId`, `clientId`, `role`) own the client↔user mapping.
- Admin side: under `/admin/access/clients` (new) account managers create client-org records and invite users via email (Resend, #131/#132 for tracking).
- Out of scope for v0: invoice payment, ticketing/support inbox, file uploads from the client back to Synozur, SLA dashboards, multi-tenant white-labeling. These are explicit follow-ups once v0 is in customer hands.

### #136 · Verify remember-me sessions get the longer 30-day window when renewed
**Depends on:** #133 (session management)

`resolveSession()` branches on `rememberMe` to choose between an 8-hour and a 30-day renewal TTL. A regression here would silently downgrade "stay signed in" sessions, signing users out far sooner than expected, but no test currently exercises the `rememberMe` branch. This task adds targeted tests that exercise the renewal code path for both session types and assert that the correct TTL is applied.

### #137 · Cover the session garbage-collector and revocation helpers with tests
**Depends on:** #133 (session management)

`sessions.test.ts` only exercises `resolveSession()`. Several other security-relevant helpers — `pruneExpiredSessions()`, `destroyAllSessionsForUser()`, `destroySessionById()`, and the token-revocation path — have no direct tests, so regressions could go unnoticed. This task adds unit and integration tests for each helper, verifying that expired sessions are deleted, active sessions are preserved, and revocation correctly invalidates the targeted tokens.

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

### #144 · Add automated tests to confirm sign-up rate limiting works
**Depends on:** #141 (sign-up rate limiting)

The registration endpoint now enforces rate limiting, but no automated tests verify that a 429 response is returned after the threshold is exceeded or that requests below the limit continue to return 201. This task adds those tests so any future change to the rate-limiting middleware is immediately caught.

### #169 · Admin audit-log viewer with entity-scoped activity tab and 365-day retention
**Depends on:** —

`auditLogTable` is heavily *written* — every admin mutation in `routes/cms/*.ts` calls `audit({ action, entity, entityId, diff })` with structured before/after diffs from `buildAuditDiff()` at `artifacts/api-server/src/lib/audit.ts:25` — but the only *read* path that exists today is `routes/cms/securityLog.ts`, which filters to a single action (`auth.login_rate_limited`) and returns 200 IPs. Nothing surfaces the full audit stream to operators, and the table grows unbounded. So when an editor asks "who deleted that case study last Tuesday?" the answer requires a live SQL session against production.

This task ships an admin audit viewer + retention:
- **API.** New `routes/cms/auditLog.ts` with `GET /cms/audit-log` accepting `actorId`, `entity`, `entityId`, `actionPrefix`, `from`, `to`, `cursor`, `limit ≤ 100`. The existing `audit_log_entity_idx` covers entity-scoped queries; add a `(actor_id, at desc)` index for the per-actor view and a `(at desc)` index for the global feed.
- **Global viewer.** New page `pages/admin/access/audit-log.tsx` with a filter bar (date range, action prefix, entity type, actor email lookup), an infinite-scroll table, and a row-detail drawer that pretty-prints the `before` / `after` diff using the same JSON-diff component planned for #67.
- **Per-artifact activity tab.** A reusable `<ActivityTab>` component fed by `(entity, entityId)` drops into every artifact edit page (post, collateral, service, solution, case-study, application, model, polaris-episode, white-paper, workshop, event, team-member) so an editor sees "Chris updated `excerpt` 2 days ago" inline without leaving the page. Permissions: gated on the same role required to *edit* the underlying artifact, not on global admin.
- **Retention.** Daily prune job in `lib/scheduler.ts` deletes `audit_log` rows older than `siteSettings.auditLogRetentionDays` (default 365). Auth / OAuth / session actions (`action LIKE 'auth.%' OR 'oauth.%' OR 'session.%'`) keep a 5-year retention regardless — security logs have a longer minimum legal hold under most enterprise procurement reviews.
- **Export.** `GET /cms/audit-log.csv` with the same filter set so legal / compliance can hand a customer a full audit trail on request.

Migrate `/admin/access/security-log` to read from `/cms/audit-log?actionPrefix=auth.` — kill the duplicated query in `routes/cms/securityLog.ts` once the new viewer ships.

Out of scope: real-time tail / websocket push (the daily-cadence audit pattern doesn't justify it yet), per-row redaction policies (PII is already kept out at write time via `buildAuditDiff`'s `ignoreKeys`). Follow-up: pipe high-severity actions (`role.grant.admin`, `oauth_client.create`, `user.delete`) to a Slack webhook so a security channel pings on each occurrence.

---

## Marketing & Lifecycle

### #83 · Gated download CTA for white papers
**Depends on:** —

White paper detail pages currently offer a plain download button. For lead generation, high-value white papers should require a visitor's name and email before delivering the file. On form submission the API creates a submission record (same `submissions` table used by contact and intake forms), sends the visitor a time-limited secure download link by email, and surfaces the submission in the admin alongside other form responses. Non-gated items keep their existing direct-download behavior. The admin collateral editor gains a "Require email to download" toggle that enables gating per item.

### #85 · Upcoming webinar registration rail
**Depends on:** —

Every webinar in the collateral library is currently treated as a past on-demand recording. This task adds an "upcoming" state: webinar records gain a `scheduled_at` date and an optional external `registration_url`. When a webinar is upcoming the detail page shows the event date and a registration CTA instead of a video player; the webinar index gains an "Upcoming" section above the on-demand grid. If no external URL is provided, an inline name/email form creates a submission record and sends a confirmation email with an .ics calendar invite attachment. Once the scheduled date passes, items revert automatically to on-demand behavior.

### #86 · Fix OG tags for social link previews — **Infrastructure shipped, production data not populated**
**Depends on:** —

The serving path is fully shipped: default OG tags are embedded in `artifacts/synozur/index.html`; `artifacts/api-server/src/middlewares/socialBotRenderer.ts` detects social crawlers by User-Agent and serves per-page values via the server-side `/api/og?path=` endpoint; the dynamic sitemap and `Sitemap:` directive are wired through `artifacts/api-server/src/routes/seo.ts`.

**Open work — data backfill (May 2026 verification):** the per-page values themselves (`seoTitle`, `seoDescription`, `ogImage` on the artifact rows) are mostly **blank in the production database**, which means the bot middleware resolves to the global defaults from `site_settings` (`seoDefaultTitleTemplate`, `seoDefaultDescription`, `seoDefaultOgImageUrl`) on virtually every URL. Functionally a shared link previews with the same title and image regardless of which insight, case study, application, or solution is being shared. This is a content-side gap, not a code gap.

Resolution path:
- Run `POST /api/seo/audit` against production to enumerate every published artifact missing one of `seoTitle` / `seoDescription` / `ogImage`. The audit code is shipped at `artifacts/api-server/src/lib/seoAudit.ts`.
- For high-volume artifacts (insights, case studies, applications, solutions, services, white papers, models), run `POST /api/seo/audit/autofill` to populate suggestions; the autofill helper never overwrites editor-set values, so it is safe to re-run.
- Editorial review pass on the autofill output before flipping the audit from warn to block.
- For OG images specifically: until the dynamic OG image generator (#161) lands, either (a) seed each artifact kind's `ogImage` from a kind-specific default set in `site_settings`, or (b) authoritatively author one OG image per top-30-traffic artifact during the launch sprint.

Tracked as a launch-readiness item (L7 above).

### #102 · Connect search engine submission to live credentials
**Depends on:** #97 (SEO / search engine submission)

The IndexNow, Google Indexing API, and Bing Webmaster Tools submission feature is fully implemented but gated behind environment variables that have not been set in production. Until these are configured the submit endpoint always returns `ok: false` for every channel. This task configures the live credentials in the production environment and verifies that newly published or updated content triggers real indexing submissions to all three search engines.

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

### #168 · Double opt-in confirmation for newsletter subscribers
**Depends on:** — (additive); pairs with #132 (the confirmation email is itself a transactional send) and #131 (HubSpot — DOI confirmation now gates the contact upsert)

`/forms/subscribe` (`artifacts/api-server/src/routes/forms.ts:499`) currently writes the submission, sends a marketing welcome via Resend, and enqueues a HubSpot contact upsert *all in one synchronous request* — there is no confirmation step. Anyone (or any bot that gets past Turnstile) can sign up an arbitrary third-party email, and a competitor flooding the endpoint with executive addresses can poison our sender reputation overnight. GDPR (Recital 32 — "clear affirmative action") and CASL effectively require an explicit confirmation event for marketing email; today the audit trail captures only IP + UA + timestamp at submit, not at confirm.

This task adds **double opt-in (DOI)**:
- **Schema.** New `subscribers` table — `email` (unique), `status: 'pending' | 'confirmed' | 'unsubscribed'`, `confirmation_token_hash`, `confirmation_sent_at`, `confirmed_at`, `confirmed_ip`, `confirmed_user_agent`, `unsubscribed_at`, `created_at`. Resubmission while `pending` rotates the token but doesn't multiply rows; resubmission while `confirmed` is a no-op.
- **Submit path.** `/forms/subscribe` writes the row as `pending` and sends a "Confirm your subscription" email via Resend with a signed link to `/subscribe/confirm?token=…`. Token signing reuses the HMAC pattern from `lib/unsubscribeToken.ts` — single helper, single secret rotation story.
- **Confirm path.** `GET /forms/subscribe/confirm?token=…` validates the signature, checks `confirmation_sent_at` is within a 7-day TTL, flips `status='confirmed'`, records the confirming IP / UA / timestamp, **and only then** enqueues the HubSpot contact upsert (`enqueueContactSubmission`) and the welcome marketing send. The page renders a success message with a one-click unsubscribe link for symmetry.
- **Existing newsletter touchpoints** (RSS-driven digests once they ship, scheduled-post notifications) gate sends on `subscribers.status='confirmed'`; pending rows never receive marketing.
- **Admin surface.** A "Pending confirmations" tab under `/admin/marketing/subscribers` showing pending vs. confirmed funnel + a manual resend-confirmation action for support cases. A 30-day pending-cleanup cron deletes rows that never confirmed.
- **Re-confirmation pass.** A one-shot `scripts/sendReconfirmationCampaign.ts` mails the existing pre-DOI subscriber list once with a "confirm to keep receiving" CTA; non-confirmers stay opted-in for transactional but get pulled from marketing lists.

Out of scope: per-list DOI (newsletter / insights digest / event invites all share one confirmation today; revisit when #132 SendGrid lists materialize). Follow-up: surface the per-source confirm-rate funnel inside #140 so we can compare DOI conversion across landing pages.

---

## Public Site UX

### ~~#84 · Seed & verify 301 redirects from Wix~~ **— Shipped (seeder); production verification ongoing**
**Depends on:** —

~~When the site migrated from Wix most content paths changed, so visitors following old links and Google's crawl index hit 404s.~~ **Shipped:** seeder lives at `artifacts/api-server/src/scripts/seedWixRedirects.ts` and ingests the three rule sources (Wix CSV, sitemap-derived rules, hand-authored rules) into `wix_redirects`; admin CRUD at `/admin/site-config/redirects.tsx`. Hit counters confirm the middleware is live. Remaining residual: a one-time spot-check pass against production logs to confirm zero high-traffic 404s map to a missing redirect — track this under #163 below.

### #133 · Constellation interactive demo sandbox on /applications/constellation
**Depends on:** — (additive on the public site); optional pairing with #128 (OAuth) if we eventually link the demo to a real free tier

The Constellation product page (`/applications/constellation`, sourced from `artifacts/synozur/src/data/applications.ts`) currently sells the AI Consulting Delivery Platform with copy + still images, the same way the other five apps are presented. For a delivery platform whose differentiator is the *feel* of AI-synthesized status reports and proactive risk surfaces, this is the weakest part of the funnel — prospects can't experience the product without booking a demo, and the demo bar is high. This task ships a **guided, sandboxed in-page demo** that lets a visitor experience three or four canonical Constellation moments without leaving the marketing site:
1. A realistic project dashboard (pre-seeded sample data — fake client, real-looking timelines, deliverables, risks).
2. The AI executive narrative ("here's what changed this week") rendered live, generated server-side from the seed data via Claude on first load and cached.
3. A risk drill-down that walks the visitor through how Constellation surfaces a slipping deliverable.
4. A simulated "send to Outlook" CTA that completes inline (no real email sent) so the visitor sees the Microsoft 365 integration story without auth.
Implementation: new `artifacts/synozur/src/components/demos/constellation/` module with a step-driven controller (URL-routable steps so we can deep-link from ads to a specific moment). Server-side: a small `/api/demos/constellation/narrative` endpoint that takes a seed id and returns a cached AI-generated narrative — keyed so we never regenerate per-visit. The interaction telemetry feeds into the experimentation framework (#140) and the HubSpot timeline (#131) — clicking through all four moments emits a high-intent `synozur_application_demo_requested` event with `app=constellation, depth=full`. Out of scope: a real free-tier login (still gated by the contact form), demos for the other five applications (apply the pattern in follow-up tasks once Constellation proves the format).

### #134 · "Ask Synozur" — Vega-pattern grounding documents + retrieval over the editorial corpus
**Depends on:** — (data is already in the CMS); pairs with #122 (multi-resource attachments give richer source material) and #131 (intent capture)

The site has accumulated a real corpus of editorial content — Insights posts, Polaris episode notes, white papers, case studies, FAQ — but visitors can only find it by browsing or search-by-title. They can't ask the corpus questions like "what does Synozur recommend for AI rollouts in financial services?" or "have you done a Constellation engagement in the public sector?" and get a grounded, cited answer. This task adds a public Q&A surface backed by **two complementary subsystems** that mirror how Vega grounds its AI assistant:

**(1) Grounding documents — Vega pattern, ported verbatim.** Standalone admin-authored documents that get **injected wholesale into the system prompt on every AI call** (no chunking, no embeddings — the whole document goes in). New `grounding_documents` table modeled on Vega's `shared/schema.ts`:

- `id uuid pk`, `title text not null`, `description text`, `category text not null`, `content text not null`, `priority integer default 0`, `is_active boolean default true`, `created_by`, `created_at`, `updated_by`, `updated_at`.
- **Categories** (driven by an enum that maps to prompt section headers, exactly as Vega does):
  - *Instructional:* `methodology`, `best_practices`, `terminology`, `examples`
  - *Contextual:* `about_synozur` (parallel to Vega's `company_os`), `brand_voice`, `audience_personas`
- **Scope.** The Synozur public site is single-tenant, so we drop Vega's `tenantId` column and replace it with optional `scope_tags jsonb` (audience class / sector / application) for filtered injection — null tags = always inject. No `is_tenant_background` flag needed; `is_active` is sufficient.
- **Server-side file parsing for editor uploads** (matches Vega's `/api/ai/parse-pdf` and `/parse-docx` endpoints): `POST /api/ai/parse-pdf` and `POST /api/ai/parse-docx` accept raw binary, return extracted text via `pdf-parse` and `mammoth`, and the admin UI pastes the result into the `content` field — keeps heavy parsing libraries out of the browser bundle.
- **Prompt construction.** New `buildSystemPrompt(scopeTags?)` server util fetches `is_active=true` documents that match the scope (or are unscoped), orders by `priority desc, category asc`, and formats each as `### <CategoryLabel>: <title>\n<content>` joined with double-newlines — identical formatting to Vega's `buildSystemPrompt`. A `getSimpleCompletion()` escape hatch (also matching Vega) skips grounding for lightweight calls like rewriting or scoring where the full corpus would just burn tokens.

**(2) Editorial corpus retrieval — separate RAG layer the model calls as a tool.** Wholesale injection works for ~10–30 grounding docs but not for 200+ Insights posts and case studies. So the *grounded answer* still comes from retrieval, exposed to Claude as a tool:

- `pgvector` + an `editorial_embeddings` table (`source_kind`, `source_id`, `chunk_index`, `text`, `embedding vector(1536)`, `model_version`, `updated_at`). A backfill worker chunks every published Insights post, case study, white paper, FAQ entry, and Polaris show-notes row into ~500-token chunks. Re-embedding triggers on publish/update via existing artifact lifecycle hooks.
- A `searchEditorialCorpus(query, filters)` Claude tool runs hybrid retrieval (vector + BM25 over `collateral.title/excerpt`) and returns ranked passages with source metadata for citation.
- The system prompt (built from grounding documents) instructs the model *when* to call this tool and how to format inline citations.

**Public surface.** New `/insights/ask` page with streaming responses, session-scoped conversation history (not persisted unless the user authenticates), and per-answer source cards. Also embedded as a discovery widget on the Insights index page. Refusal path returns a "we don't have published material on that — talk to a human?" CTA wired to the contact form.

**Admin surfaces.**
- `/admin/ai/grounding` — Vega-style list view (sorted by priority desc, then category) with the standard CRUD form, file upload, and a per-row active toggle. RBAC gated on a new `MANAGE_AI_GROUNDING` permission granted to admins and editors.
- `/admin/insights/questions` — every question + retrieved sources + final answer logged (PII-redacted), surfacing top questions, click-through to sources, refusal rate, a "low retrieval confidence" report flagging questions where the editorial corpus came up empty, and a "create insight on this topic" shortcut.

Out of scope: multi-tenant grounding scope (single-tenant for now), open-ended chat memory across sessions, fine-tuning, multi-language Q&A (English first; revisit after #139), live foundation-data injection (Vega pulls live mission/vision/values; on this site that role is filled by the `about_synozur` grounding category, edited as a normal document). Follow-up: pipe high-intent questions ("how do I buy / start") to the Astra concierge for a soft hand-off.

### ~~#138 · Stop pillar overview pages from competing with service pages on Google~~ **— Shipped (canonical hint); Search Console verification pending**
**Depends on:** #55 (services hierarchy public pages)

~~The route `/services-overview/:slug` and `/services/:slug` render overlapping content and metadata for the same service pillar~~ **Shipped:** `artifacts/synozur/src/pages/services-overview.tsx` now emits a canonical hint pointing to the authoritative service-detail URL (lines 7–11). Residual: a Search Console Coverage report sweep to confirm Google has consolidated indexing on the canonical URL — fold into the SEO submission verification under #102.

### #154 · Ship a Web App Manifest (PWA) for the public site
**Depends on:** —

The site has no `manifest.webmanifest` / `manifest.json`, so installing the site as a PWA falls back to browser defaults and the `theme-color` / `display` / app-icon set is empty. This hurts iOS Safari "Add to Home Screen" appearance and blocks future PWA features (offline cache for the home page, push notifications for content launches). This task adds a manifest at `artifacts/synozur/public/manifest.webmanifest` with the Synozur brand colors, app icons (192/512 PNG plus maskable), `display: standalone`, `start_url`, and a matching `<meta name="theme-color">` plus `<link rel="manifest">` in `index.html`. Out of scope for v1: a service worker / offline support — handle in a follow-up once the manifest itself is verified in Lighthouse PWA audits.

### ~~#155 · Add security headers via `helmet` in the API server~~ — **Shipped (PR #68)**
**Depends on:** —

~~The Express API at `artifacts/api-server/src/app.ts` does not emit a Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy header.~~ **Shipped:** `helmet` wired into `artifacts/api-server/src/app.ts` via `artifacts/api-server/src/lib/securityHeaders.ts` — emits HSTS (2yr + preload), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy, and CSP in `Content-Security-Policy-Report-Only` mode. The same header set is applied to every public HTML response in `artifacts/synozur/server.mjs`. CSP allowlist covers GA4, LinkedIn Insight Tag, Meta Pixel, Cloudflare Turnstile, YouTube, Microsoft Bookings, Google Fonts, and Libsyn. Violations are deduplicated into the `csp_violations` table via `POST /api/csp/report` (rate-limited, two payload shapes accepted). Admin dashboard at `/admin/site-config/csp-violations` (Site Config nav section, PR #68) lets operators filter by directive, inspect hit counts, and delete resolved rows. The dashboard also surfaces an enforce-readiness verdict (`ready` / `monitoring` / `blocked` / `no-data`) backed by `GET /api/cms/csp/readiness` (PR #71, `artifacts/api-server/src/routes/cms/cspViolations.ts`), computed from days-since-last-violation against a configurable 7-day clean window; it also exposes `GET /api/cms/csp/directives` (distinct violated-directive list for the filter dropdown) and `DELETE /api/cms/csp/violations` (bulk-clear). Set `CSP_ENFORCE=1` to promote from report-only to enforcing once the readiness banner shows `ready`.

### #156 · Make Lighthouse CI block PRs instead of running on manual trigger
**Depends on:** —

`.github/workflows/quality.yml` runs `lhci autorun` only under `workflow_dispatch`. The thresholds in `lighthouserc.json` (SEO ≥0.9, perf ≥0.85, LCP ≤2.5s, CLS ≤0.1, TBT ≤300ms) already exist but never gate a PR. This task moves the Lighthouse step into the standard `pull_request` job so any PR that regresses below the configured budgets fails CI, and adds a GitHub PR comment integration via `@lhci/github-action` so the per-page deltas surface in the PR conversation. Pairs naturally with the warn → hard-mode flip in BACKLOG.md "Quality gates" #3 — both are about turning advisory signals into enforced gates once the inherited backlog is clear.

### #157 · CI broken-link checker over the published site
**Depends on:** #156 (lands alongside the PR-blocking Lighthouse run)

There is no CI step that crawls the built site and verifies that internal links, image references, and the sitemap entries all resolve. The Wix-migration redirect work and the steady stream of editorial content both create opportunities for stale links to slip through. This task adds a `lychee` (or `linkinator`) job to the quality workflow that crawls the staging deploy from the sitemap root, asserts no 4xx / 5xx, and writes a per-PR link-health summary. False-positives go in a checked-in `lychee.toml` ignore file (e.g. social URLs that 403 on bot user agents) so the signal stays high.

### #158 · Add `eslint-plugin-jsx-a11y` and a pre-commit a11y/SEO gate
**Depends on:** —

The codebase has axe-core integration in the Playwright suite but no static a11y linting. `eslint-plugin-jsx-a11y` would catch the bulk of the same issues at edit time — missing alt text, invalid ARIA, label-input mismatches, anchor-without-href — long before Lighthouse or axe can. This task: (a) installs the plugin in the workspace ESLint config, (b) sets the rules at `error` for the must-haves and `warn` for the stylistic ones, (c) adds a Husky pre-commit hook (or lint-staged) that runs `eslint` on staged TSX files, (d) fixes the existing violations the new rules surface. Pairs with the publish-block warn-mode work in BACKLOG.md "Quality gates" #1 — author-time linting catches issues the heading-order check today only catches at publish time.

### #159 · Expand JSON-LD schema coverage (LocalBusiness, Person, Review, VideoObject)
**Depends on:** —

The site emits Organization, Article, FAQPage, BreadcrumbList, and Event JSON-LD today, but several artifact types still rank weaker than they could because their structured data is incomplete. This task adds: **LocalBusiness** schema on `/contact` and the office detail card (address, phone, opening hours, geo), **Person** schema on team-member detail surfaces (job title, image, sameAs links to LinkedIn), **VideoObject** schema on collateral video items and Polaris episodes (uploadDate, duration, thumbnailUrl, contentUrl), and **Review/AggregateRating** wrappers on testimonials so SERPs can render the rating star treatment. NewsArticle vs Article distinction is also handled here: insights tagged as `news` emit `NewsArticle`, the rest stay `Article`. Verify each schema with the Google Rich Results Test before merge.

### #160 · Search Console domain-property verification + indexing dashboard
**Depends on:** #102 (live search-engine submission credentials)

Production verification with Google Search Console and Bing Webmaster Tools is currently file-upload or DNS-record based and has never been re-confirmed after the Wix → Synozur cutover. This task: (a) adds a `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` line to `index.html` keyed off env variables (so dev/staging/prod can each carry their own token without code changes), (b) confirms DNS TXT verification is also in place at the domain registrar, (c) builds an internal `/admin/marketing/seo-coverage` page that reads the Search Console URL Inspection API + Bing Webmaster API on a daily cron and surfaces "indexed", "discovered — not indexed", "crawl error", and "soft 404" buckets per artifact type, so editors can tell at a glance whether a published post has actually made it into the index.

### #161 · Dynamic OG image generation for insights, case studies, and Polaris episodes
**Depends on:** —

`/api/og?path=` returns a static HTML preview today; OG images themselves are author-uploaded statics or fall back to the global default. Auto-generated, on-brand OG images per article would lift social CTR without adding production work for editors. This task adds a `/api/og/image?kind=&id=` endpoint on the API server that renders a 1200×630 PNG using `@vercel/og` (or `satori` + `resvg`) with: the artifact title, author name and avatar, kind badge (Insight / Case Study / White Paper / Polaris), and the Synozur wordmark over the brand-gradient background. Cache the generated image in object storage keyed by `(kind, id, lastModified)` and serve it via a CDN-friendly URL referenced from each artifact's `<meta property="og:image">` when no explicit override is set. Editors can still upload a custom OG image to override the generated one.

### #162 · Use 410 Gone and 308 Permanent Redirect for unpublished and moved content
**Depends on:** —

When a published artifact is unpublished today, the route returns 200 with a `noindex` meta tag rather than the more correct 410 Gone — which is the explicit signal Google uses to drop the URL from the index quickly. Similarly, the Wix redirect middleware emits 301 / 302 only, never 308 (the version of 301 that preserves the request method, which matters when migrated POST endpoints are involved). This task: (a) updates the public artifact loaders to return HTTP 410 with a friendly body when the row has `status = 'archived'` or `unpublished_at < now()`, (b) extends the Wix redirect schema with a `status_code` column that supports 301 / 302 / 307 / 308 and surfaces the choice in the redirect admin UI, (c) tightens the sitemap exclusion logic so unpublished URLs are also actively removed from the sitemap on the next regeneration.

### #163 · Tune robots meta directives and add a discovery-friendly 404 page
**Depends on:** —

Two related improvements that share a single PR. (a) The `Meta` component does not emit `max-snippet`, `max-image-preview`, or `max-video-preview` directives — the defaults Google applies are conservative and clip the rich SERP previews insights and case studies could otherwise earn. Adding `max-snippet:-1, max-image-preview:large, max-video-preview:-1` on indexable artifact pages is a one-line win. (b) `pages/not-found.tsx` is `noindex` but offers no escape route — no search box, no top-categories list, no "popular insights" tile. Visitors who land here from a stale link bounce. Add a small surface that surfaces the sitemap top-level sections, a search input that hits `/api/search`, and a "report this missing page" form that writes to the existing `not_found_logs` table for editor review.

### #164 · Extend the event-detail share rail to insights, case studies, and white papers
**Depends on:** —

`event-detail.tsx` already ships a clean LinkedIn / Facebook / copy-link share rail (`facebookShare`, `share-linkedin` test id) — pure `<a href>` with pre-filled URLs, no third-party script, anchored below the hero. The same pattern is missing on `insight-detail.tsx`, `case-study-detail.tsx`, and `white-paper-detail.tsx`, which are the highest-volume editorial surfaces. This task lifts the existing share-button cluster into a small `components/share-rail.tsx` (kind, title, url props) and drops it under the hero on each editorial detail page. Includes an X/Twitter target alongside LinkedIn and Facebook, plus a `navigator.share` fallback on mobile. Pairs with #86 (already shipped) — the OG tags ensure the shared link renders a rich card.

### ~~#165 · Honor `prefers-color-scheme` for first-time visitors~~ **— Shipped May 2026**
**Depends on:** —

~~Dark mode itself is shipped: `context/theme.tsx` exposes `useTheme()`, `components/ui/theme-toggle.tsx` renders the toggle, and the user's choice persists in `localStorage` under `synozur-theme`. The remaining gap is system-preference detection: `getInitialTheme()` only reads localStorage and falls back to a hard-coded `"dark"`, so a first-time visitor on a system set to light receives the dark canvas regardless of their OS preference.~~ **Shipped:** `getInitialTheme()` in `artifacts/synozur/src/context/theme.tsx` now reads `window.matchMedia("(prefers-color-scheme: light)")` when localStorage has no value, and `ThemeProvider` subscribes to the same media query's `change` event (using `addEventListener` with a Safari-compat `addListener` fallback) so the theme follows OS changes until the user explicitly toggles — once `synozur-theme` is set, the explicit choice wins. The pre-hydration script in `artifacts/synozur/index.html` mirrors the same precedence so first paint matches React's initial state, and a `<meta name="color-scheme" content="light dark">` tag is emitted so default form-control and scrollbar colors render correctly. The toggle stays binary — no tri-state.

### #139 · Internationalization foundation (English baseline + one launch locale)
**Depends on:** — (architecture); pairs with #110 (some audience classes will skew geographically), #130 (theme assets may need locale variants)

Every public string and every editorial CMS field on the site is English-only today. Enterprise procurement in EU and APAC stalls on this even when the buying team speaks English. This task lays the **i18n foundation** without trying to translate the entire corpus on day one:
- **Code-side i18n.** Adopt FormatJS (`react-intl`) inside `artifacts/synozur` with a build-time message-extraction step. Every string in the codebase moves to a `messages` catalog keyed by namespace; `en` is the baseline. Locale-routed URLs (`/de/insights/...`, `/ja/applications/constellation`) with a transparent default for `en` to avoid breaking existing links.
- **Content-side i18n.** Add a `locale` column + per-locale row strategy for translatable artifact fields on `collateral`, `services`, `solutions`, `case_studies`, `faq_items` — keyed (`canonicalId`, `locale`). The base row in `en` is canonical; per-locale rows are translations linked back. Admin UI gains a language switcher per editable field with a visible "translation lag" indicator (e.g. "EN updated 3 days after this DE translation").
- **Locale negotiation.** `Accept-Language` + explicit selector + persisted user preference (in `users.preferredLocale` for authenticated users, in localStorage for anon).
- **One launch locale.** Pick one (de or ja) for the first translation pass — translate the 30 highest-traffic public pages plus the four service pillars and the six application pages.
- **Translation workflow.** Integrate with Crowdin or Lokalise (decide during implementation) so external translators work in their native tooling rather than the admin UI; CI exports updated `messages.en.json`, fetches translated bundles, and writes them into `artifacts/synozur/src/locales/`.

Out of scope: right-to-left languages (separate pass), region-specific content (different case studies per locale — possible but not v1), multi-currency pricing. Follow-up: localize the Astra concierge and the Insights Q&A (#134) once the editorial corpus has enough translated content to retrieve from.

### #166 · Lock down `/ai/chat` — auth, rate limits, conversation ACL, per-identity token budget
**Depends on:** — (must ship before #134 / Astra concierge expose any public surface)

The AI chat infrastructure (`artifacts/api-server/src/routes/aiChat.ts`) is already mounted but is wide open in three independent ways:

1. **No authentication.** Anyone on the internet can `POST /ai/chat` with an arbitrary message and stream a Claude response on Synozur's Anthropic bill. There is no anonymous-session cookie, no Turnstile gate, no rate limiter on the route. A trivial script can drain the daily budget in minutes.
2. **No conversation ACL.** Conversations are keyed by integer primary key (`conversations.id`) with no `owner_user_id` or `owner_session_id` column. `GET /ai/conversations/:id/messages` returns the full message history for any id the caller asks for, so a curious visitor can walk `1, 2, 3 …` and read every chat anyone else has had — including the user-pasted PII that grounding-doc-driven Q&A typically attracts.
3. **No token budget.** There is no per-IP / per-user / global daily ceiling. Once #134 ships and the editorial corpus retrieval layer comes online, a single unhandled abuse pattern (long-context prompt injection, retry loops) can spike spend by 100× without any circuit breaker.

This task hardens the endpoint before any public surface lights it up:
- **Authn / session.** Require either an authenticated session cookie (`requireAuth`) or a server-issued anonymous chat session — `POST /ai/sessions/start` mints a signed cookie + persists a row in a new `ai_chat_sessions` table; the cookie binds to a session id, not just an IP, so VPN flips don't reset the budget. Turnstile gates `POST /ai/sessions/start` so bots can't trivially mint fresh sessions.
- **ACL.** Add `owner_user_id uuid null` and `owner_session_id uuid null` to `conversations` (one of the two is non-null per row). `GET /ai/conversations/:id/messages` and `POST /ai/chat` both check `owner_*` against the caller. UUIDv7 the table while we're at it — integer ids are an enumeration footgun on a public surface.
- **Rate limits.** Per-IP and per-session limiters using the existing `rateLimit({...})` pattern from `routes/insights.ts`: 20 messages/hour per session, 60/hour per IP, burst of 3 in 10 seconds. 429s emit `audit.action='ai.chat.rate_limited'`.
- **Token budget.** A new `ai_chat_token_usage` daily-rollup table counts input + output tokens per session / per IP / global. Hard cap at `siteSettings.aiChatDailyTokenCapPerSession` (default 50k) and `aiChatDailyTokenCapGlobal` (default 5M). Exceeding the cap returns a polite 429 with retry-after midnight UTC; global cap exceedance also pages the on-call.
- **Prompt-injection guardrails.** Strip `system:` / `assistant:` role headers from the user message before composing `chatMessages`; cap the total `priorMessages` window at 20 turns or 50k tokens (oldest dropped) so an attacker can't bloat the context with their own injected history. Surface a `safety.suspected_injection` audit event when guardrails fire.
- **Cost observability.** Log per-call `inputTokens` / `outputTokens` / `cacheReadTokens` (pairs with #167) into the rollup table so the Site Health dashboard can chart cost-per-day and per-session.

Out of scope: full content-moderation classifier (rely on Claude's own safety training for now); per-message PII scrubbing on storage (separate task once retention policy is decided). Follow-up: extend the same authn / budget envelope to a future `POST /ai/grounding/parse-pdf` endpoint when #134 lands the file-upload path.

### #167 · Apply Anthropic prompt caching across the AI chat + grounding pipeline
**Depends on:** #166 (cost observability lands the metrics that prove the win); pairs with #134 (the corpus-retrieval tool layer benefits from the same pattern on its tool-use turn)

`buildSystemPrompt({ scopeTags, conciergeOnly })` (`artifacts/api-server/src/lib/ai/grounding.ts`) reads every `is_active=true` grounding document on every call, formats them into one large system block, and the caller at `routes/aiChat.ts:142` passes it as `system: systemPrompt` with no caching directive. The same is true of `priorMessages` — for a 30-turn conversation, every turn re-sends the entire history as fresh input tokens. With the planned grounding-document corpus (Vega-style instructional + contextual docs) the system block alone is comfortably 10–30k tokens, and at typical turn cadence the cost is dominated by re-reading content that hasn't changed.

The Anthropic SDK supports prompt caching via `cache_control: { type: "ephemeral" }` markers on content blocks — a 5-minute TTL with a ~90 % discount on cached input tokens. `aiChat.ts` already streams via `anthropic.messages.stream(...)` so wiring caching is a one-line marker change per block, but the *correctness* of marker placement matters (cache only stable prefixes; never cache the user's current message).

This task wires caching across every AI surface and instruments the savings:
- **System block.** Convert `system: systemPrompt` (string) to a single-element content array `[{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]`. The grounding-doc corpus changes only on edit, so within any 5-minute window every turn for every concurrent visitor reuses the cached block.
- **Conversation history.** When sending `priorMessages`, mark the *last* assistant message before the new user turn with `cache_control: { type: "ephemeral" }`. That caches the entire prior conversation as a stable prefix; the only fresh tokens are the new user message and the streamed assistant response. Re-cache on every turn so the 5-minute window keeps sliding.
- **Tool definitions (#134 follow-on).** When the editorial-corpus `searchEditorialCorpus` tool ships, mark its tool-definition block as cached too — tool schemas don't change per call.
- **Cache-hit metrics.** The streaming response includes `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens` on the `message_start` event. Persist both into the `ai_chat_token_usage` rollup from #166 so the Site Health page renders cache-hit rate and dollar savings per day. A regression that drops hit rate below 50 % pages the on-call.
- **`getSimpleCompletion()` escape hatch.** Lightweight calls (rewriting, scoring, scope-tag classification) that bypass grounding stay non-cached — caching a small one-off block is net-negative because cache-write tokens cost more than re-reading would.
- **Fallback safety.** Cache markers are a hint, not a contract — the model still produces correct output if the cache is cold. Add an integration test that exercises a cold-cache run and a warm-cache run against a stub backend so a future SDK upgrade that changes the marker shape doesn't silently regress to non-cached.

Expected impact: based on Anthropic's published numbers for similar patterns, a 75–90 % reduction in input-token cost on multi-turn sessions, with no observable latency change (cache reads are faster, not slower, than fresh reads).

Out of scope: 1-hour-TTL caching tier (still in beta at the time of writing — revisit once GA). Follow-up: when `@synozur/auth-sdk` (per BACKLOG.md "OAuth provider follow-ups" #5) ships, expose the same caching scaffold to downstream apps that proxy through this site's AI surface.

### #170 · Public-site search endpoint and `/search` page powered by Postgres FTS
**Depends on:** — (additive); referenced by #163 (the discovery-friendly 404 page assumes a `/api/search` endpoint exists), unblocks #134 phase 0 (cheaper full-text retrieval before the embedding layer ships)

The site has a real editorial corpus — Insights posts, case studies, white papers, services, solutions, FAQ, Polaris episodes, applications, models — but **no on-site search**. There is no `/api/search` route, no `/search` page, no search box in the header. Visitors who arrive via Google can only land on the post they searched for; once on the site they have to navigate by category or guess at slugs. The 404 page proposed in #163 explicitly assumes "a search input that hits `/api/search`" — so #163 can't fully ship until this lands. And the embedding-based corpus retrieval planned in #134 is months of work; a Postgres-FTS layer is hours of work and covers ~80 % of the same use-cases (find me posts about "data governance") without an embedding pipeline, an `editorial_embeddings` table, or a re-embedding cron.

This task ships a tsvector-backed search across every published artifact:
- **Schema.** Add a generated `search_tsv tsvector` column to each indexed artifact table (`posts`, `case_studies`, `white_papers`, `services`, `solutions`, `faq_items`, `polaris_episodes`, `applications`, `models`) computed as `setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') || setweight(to_tsvector('english', coalesce(body_text, '')), 'C')`. GIN index on each `search_tsv`. Recomputation is automatic via Postgres `GENERATED ALWAYS` so no app-side trigger or backfill cron is needed beyond a one-shot `REINDEX` after the column lands.
- **Endpoint.** `GET /api/search?q=&kind=&limit=&cursor=` runs `plainto_tsquery('english', :q)` against each enabled kind in parallel (UNION ALL with a kind discriminator), ranks via `ts_rank_cd(search_tsv, query) * kind_boost` where `kind_boost` is editorially configurable in `site_settings.searchKindBoosts` (default `{post:1.0, case_study:1.2, white_paper:1.1, service:1.5, solution:1.5}` so commercial pages outrank blog posts on equal-relevance ties), filters out `status != 'published'` and `deleted_at is not null`, returns `[{kind, id, slug, title, excerptHtml, rankScore}]` with `excerptHtml` produced by `ts_headline` for inline highlighting. Cursor pagination, `limit ≤ 25`.
- **Public page.** New `pages/search.tsx` with a query input (synced to the `?q=` URL param), per-kind tabs, infinite scroll, and a "no results — try X / talk to a human" CTA. SSR-friendly metadata (`<title>Search results for "{q}" — Synozur</title>`, `noindex` so the SERP isn't full of internal search URLs).
- **Header search.** A small search-icon button in the existing header that opens a command-palette-style overlay (Cmd-K) with live results from the same endpoint. Reuses the `command.tsx` shadcn primitive that's already in the bundle.
- **404 page wiring.** Drop the search input from #163 against this endpoint so a stale-link visitor sees "Did you mean…" hits before bouncing.
- **Telemetry.** Log `(query, resultCount, clickedKind, clickedRank)` into a new `search_queries` table; surface a "top 50 zero-result queries" report on the existing `/admin/insights/post-analytics`-style page so editorial sees content gaps. Pairs naturally with #134's "low retrieval confidence" report — both are surfacing the same signal at different layers.

Out of scope: typo tolerance (Postgres FTS has stemming but not fuzzy matching — defer to embeddings via #134), multi-language search (single-language `'english'` config; revisit when #139 lands a launch locale), private-content search inside Galaxy / partner portals (separate ACL surface).

---

## Strategic Roadmap

These entries describe future initiatives that do not yet have a project task system record. They are tracked here for planning purposes but are not counted in the active-task total above.

### Interactive maturity assessment replacing the static service-pillar pages
**Pairs with:** #131 (lead capture into HubSpot), case-study drafts pipeline (below)

The four service pillars today are essentially brochure pages — well-written but passive, and they convert via the same generic contact form as every other page. This initiative replaces (or augments — a/b test it) the pillar pages with an **interactive maturity assessment**. A visitor answers 10–14 questions across themes (AI readiness, delivery maturity, data foundation, change-management posture, technical debt) and gets:
- A scored maturity profile per dimension with a clear narrative.
- A personalized roadmap recommending specific Synozur services (mapped from the existing `services` table), solutions (mapped from `solutions`), and applications (Constellation, Vega, etc.) — with cited reasoning per recommendation.
- A downloadable PDF report (rendered server-side) the visitor can email to themselves and share internally.
- Optional contact-handoff to a real conversation, with the assessment results pre-populated into the contact-form payload and written through to HubSpot (#131) as contact properties + a `synozur_assessment_completed` timeline event.
Implementation: new tables `assessments` (`id`, `slug`, `version`, `published`), `assessment_questions` (`id`, `assessmentId`, `text`, `dimension`, `weights jsonb`, `sortOrder`), `assessment_responses` (anonymous + authenticated, with pii flag), `assessment_recommendations` (mapping from score profiles to services/solutions/applications). Admin UI under `/admin/marketing/assessments` lets non-engineers author new assessments, edit recommendations, and version them. Public surface at `/assessments/:slug` with a polished step-by-step UI. Out of scope: gamified scoring, multi-user team assessments (single-respondent only for v1), CRM-side scoring sync. Follow-up: surface the assessment as the primary CTA on the home page once we've validated conversion vs. the existing contact form.

### Astra AI concierge — site-wide chat assistant
**Depends on:** #134 (reuses both subsystems: the Vega-pattern grounding documents that build the system prompt, and the editorial-corpus retrieval tool); pairs with #131 (handoff to humans), maturity assessment above (deep-link into assessment)

Synozur's product family already follows a celestial naming convention (Vega, Orion, Nebula, Constellation, Orbit, Zenith) and "Polaris" is reserved for the podcast brand, so the concierge takes a distinct star-themed name: **Astra**. This initiative adds a persistent chat widget, branded as "Astra," that helps visitors navigate the site and answers questions on the spot. Scope:

- Floating chat button in the lower-right of every public page (and inside the Galaxy portal once #135 ships, with deeper context).
- **System prompt is built from the same `grounding_documents` table as Ask Synozur** so Ask Synozur and Astra can never disagree about Synozur methodology, brand voice, or terminology. Astra-specific guidance (greeting tone, escalation rules, when to offer a meeting) is added as new grounding documents in a `concierge_persona` category — *not* a parallel table — keeping the Vega "one grounding store, multiple consumers" property intact.
- Backed by Claude with three tool integrations: (a) the `searchEditorialCorpus` retrieval tool from #134 for content questions; (b) a `bookMeeting` tool that surfaces a Calendly-style scheduler; (c) a `submitContactForm` tool that fills the existing contact form on the visitor's behalf with their permission.
- Streaming responses with markdown + source-card rendering identical to the Ask Synozur page.
- An optional `concierge_eligible boolean default true` column on `grounding_documents` lets editors exclude an instructional doc from the concierge prompt without removing it from Ask Synozur (e.g. an internal-history doc that's fine on `/insights/ask` but shouldn't shape a sales chat). Default true keeps the shared-store invariant for normal cases.
- Strict guardrails: refuse pricing speculation, refuse to commit Synozur to delivery, hand off to a human via the contact form whenever the visitor explicitly asks for one or the model's confidence drops. Guardrails live as `best_practices` grounding documents so editors can tune them without code changes — same Vega pattern.
- Cookie-consent gated; conversation transcripts (with PII redaction) saved when the visitor consents and surfaced to admins under `/admin/marketing/astra` for review and content-gap mining — feeding the same low-retrieval-confidence report from #134 so editors see one unified view of where the corpus is thin.
- Rate-limited per IP and per session; abuse triggers a captcha and then a soft block.

Out of scope: voice mode, multi-language responses (#139 follow-up), agentic actions beyond the three tools above, a separate grounding-document table for the concierge (deliberately shared with #134; the `concierge_eligible` flag and the `concierge_persona` category are the only divergences). Follow-up: integrate the maturity assessment so Astra can steer relevant visitors into the assessment flow.

### Programmatic case-study drafts from Constellation engagement outcomes
**Depends on:** #128 (OAuth provider, so Constellation can talk back to this site as a registered client); pairs with consent workflow inside Constellation

Synozur runs more delivery work through Constellation (`scdp.synozur.com`) than the marketing team can write up — every engagement accumulates real artifacts (timeline adherence, risks burned down, hours saved, AI-synthesized executive narratives) that would make excellent case studies, but turning them into publishable copy today means a manual interview cycle weeks after the project closes. This initiative builds a **case-study drafting pipeline** that pulls anonymized Constellation outcomes into this site's CMS as `draft` rows for editor review. Scope: a new outbound API in Constellation publishes per-engagement summaries to `POST /api/cms/case-study-drafts` on this server (authenticated as a registered OAuth client per #128, with the `case_study.draft` scope); the endpoint validates the payload (project name, client display name, sector, summary metrics, key risks mitigated, timeline, anonymization flag), runs it through a draft-generation prompt against Claude (configurable model/version, prompt versioned in DB so we can A/B), and inserts a `draft` post into the existing `case_studies` table linked to the `collateral` artifact. Admin UI in `pages/admin/library/case-studies/` gains a "Generate from Constellation" button that lists eligible engagements (those with the client's marketing-consent flag set on the Constellation side), a side-by-side view of the raw outcome data and the generated draft, and an inline diff editor so the editor can refine before promoting to `scheduled` / `published`. A small audit trail records which Constellation engagement seeded which case study, the prompt + model version used, and the human edits applied — giving us both lineage and a feedback loop to improve the prompt. Out of scope: auto-publishing without human review (always-draft is a deliberate constraint), pulling testimonials directly from clients (separate consent workflow). Follow-up: extend to Polaris episode show-notes once the Polaris production pipeline matures.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| ~~#56~~ | ~~Let editors manage services and solutions in the admin~~ — **Shipped** | Content Library | #40 |
| ~~#57~~ | ~~Verify the new services pages with automated browser tests~~ — **Shipped** | Admin Access & People | #40 |
| #60 | Preview services and solutions before publishing | Content Library | #39, #56 |
| #61 | Track edit history for services and solutions | Content Library | #39, #56 |
| #66 | Preview a revision's content before restoring it | Content Library | #48 |
| #67 | Show a diff between the current version and a past revision | Content Library | #48 |
| #68 | Auto-trim old post revisions | Content Library | #48 |
| #75 | Bulk reorder featured library items via drag-and-drop | Content Library | #69 |
| #76 | Show a live preview of how a library item will appear on the public site | Content Library | #69 |
| #83 | Gated download CTA for white papers | Marketing & Lifecycle | — |
| ~~#84~~ | ~~Seed & verify 301 redirects from Wix~~ — **Shipped (seeder)** | Public Site UX | — |
| #85 | Upcoming webinar registration rail | Marketing & Lifecycle | — |
| #86 | Fix OG tags for social link previews — **infrastructure shipped, prod data backfill open (L7)** | Marketing & Lifecycle | — |
| #102 | Connect search engine submission to live credentials | Marketing & Lifecycle | #97 |
| #109 | Careers / HR module under /admin/people/careers | Admin Access & People | — |
| #110 | Show a video thumbnail preview when a custom hero video is active | Admin Access & People | #106 |
| #111 | Validate video uploads before they reach object storage | Admin Access & People | #106 |
| #119 | Add automated browser tests for the full sign-in and sign-out flow | Admin Access & People | #115 |
| #128 | OAuth 2.0 / OIDC provider for other Synozur web apps | Admin Access & People | #110 |
| #129 | Cross-app switcher (Constellation, Vega, …) for signed-in users | Admin Access & People | #128 |
| #130 | Admin-controlled UX theme switcher (Baseline / Aurora / …) | Admin Access & People | #128, #110 |
| #132 | SendGrid integration for marketing email and deliverability redundancy | Marketing & Lifecycle | — |
| #133 | Constellation interactive demo sandbox on /applications/constellation | Public Site UX | — |
| #134 | "Ask Synozur" — Vega-pattern grounding documents + retrieval over the editorial corpus | Public Site UX | — |
| #135 | Galaxy client portal — v0 | Admin Access & People | #110, #111, #128 |
| #136 | Verify remember-me sessions get the longer 30-day window when renewed | Admin Access & People | #133 |
| #137 | Cover the session garbage-collector and revocation helpers with tests | Admin Access & People | #133 |
| ~~#138~~ | ~~Stop pillar overview pages from competing with service pages on Google~~ — **Shipped (canonical)** | Public Site UX | #55 |
| #139 | Internationalization foundation (English + one launch locale) | Public Site UX | — |
| #140 | Experimentation framework + conversion-funnel analytics | Marketing & Lifecycle | — |
| #141 | Partner & co-marketing portal | Admin Access & People | #110, #111, #128 |
| #144 | Add automated tests to confirm sign-up rate limiting works | Admin Access & People | #141 |
| #151 | Show spam comment count badge on the moderation navigation item | Content Library | #54 |
| ~~#152~~ | ~~Add Akismet integration to catch more spam automatically~~ — **Shipped (code path)** | Content Library | #54 |
| #153 | Make the spam rules settings page accessible to end-to-end automated testing | Content Library | #54 |
| #154 | Ship a Web App Manifest (PWA) for the public site | Marketing & Lifecycle | — |
| ~~#155~~ | ~~Add security headers via `helmet` in the API server~~ — **Shipped (PR #68)** | Marketing & Lifecycle | — |
| #156 | Make Lighthouse CI block PRs instead of running on manual trigger | Marketing & Lifecycle | — |
| #157 | CI broken-link checker over the published site | Marketing & Lifecycle | #156 |
| #158 | Add `eslint-plugin-jsx-a11y` and a pre-commit a11y/SEO gate | Marketing & Lifecycle | — |
| #159 | Expand JSON-LD schema coverage (LocalBusiness, Person, Review, VideoObject) | Marketing & Lifecycle | — |
| #160 | Search Console domain-property verification + indexing dashboard | Marketing & Lifecycle | #102 |
| #161 | Dynamic OG image generation for insights, case studies, and Polaris episodes | Marketing & Lifecycle | — |
| #162 | Use 410 Gone and 308 Permanent Redirect for unpublished and moved content | Public Site UX | — |
| #163 | Tune robots meta directives and add a discovery-friendly 404 page | Public Site UX | — |
| #164 | Extend the event-detail share rail to insights, case studies, and white papers | Marketing & Lifecycle | — |
| #165 | Honor `prefers-color-scheme` for first-time visitors | Public Site UX | — |
| #166 | Lock down `/ai/chat` — auth, rate limits, conversation ACL, per-identity token budget | Public Site UX | — |
| #167 | Apply Anthropic prompt caching across the AI chat + grounding pipeline | Public Site UX | #166 |
| #168 | Double opt-in confirmation for newsletter subscribers | Marketing & Lifecycle | — |
| #169 | Admin audit-log viewer with entity-scoped activity tab and 365-day retention | Admin Access & People | — |
| #170 | Public-site search endpoint and `/search` page powered by Postgres FTS | Public Site UX | — |
| — | Interactive maturity assessment replacing the static service-pillar pages | Strategic Roadmap | #131 |
| — | Astra AI concierge — site-wide chat assistant | Strategic Roadmap | #134 |
| — | Programmatic case-study drafts from Constellation engagement outcomes | Strategic Roadmap | #128 |
