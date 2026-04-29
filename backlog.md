# Synozur Alliance — Product Backlog

> Last updated: April 28, 2026  
> 35 tracked tasks · 3 strategic roadmap items · 105 merged · 30 cancelled

Tasks are grouped by theme. Entries with a `#` ref correspond to project task system records (PROPOSED or active). Entries in the **Strategic Roadmap** section are planned future initiatives that do not yet have a project task record.

---

## Content Library

### #56 · Let editors manage services and solutions in the admin
**Depends on:** #40 (services hierarchy backend)

The services hierarchy lives in the database but can only be updated by re-running an ingest script — editors have no admin UI to manage it. This task adds a full CRUD interface inside the existing admin shell: a `/admin/services` index listing all four pillars and their children, edit forms for services, solutions, methodology blocks, and capability blocks, drag-to-reorder lists for methodology and capability items, rich-text editing via TipTap, icon upload via App Storage, and role gating so editors and admins have write access while contributors are read-only.

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

### #152 · Add Akismet integration to catch more spam automatically
**Depends on:** #54 (Insights comments)

The current spam scorer uses rule-based heuristics — link count, keyword list, domain blocklist. The `spamScorer.ts` file already has an Akismet code path that activates when `AKISMET_API_KEY` is set, but the environment variable is not yet configured and the HTTP call needs validation. Enabling Akismet as an additional scoring layer would significantly raise the catch rate without requiring ongoing rule maintenance.

### #153 · Make the spam rules settings page accessible to end-to-end automated testing
**Depends on:** #54 (Insights comments)

The admin area uses Entra SSO exclusively so the Playwright test runner cannot sign in programmatically to reach the spam rules settings page. The link threshold, keyword list, and domain blocklist UI in site-settings.tsx was manually verified to compile but has no automated test coverage. This task adds a test-environment auth bypass (strictly gated on `NODE_ENV=test`) and adds the missing Playwright tests for the save and remove interactions.

---

## Admin Access & People

### #57 · Verify the new services pages with automated browser tests
**Depends on:** #40 (services hierarchy backend + public pages)

The pillar overview, per-pillar overview, service-detail, and solution-detail pages were built and manually verified but have no automated test coverage. This task adds Playwright end-to-end tests for the full services flow: loading the overview, navigating to a pillar, browsing to a solution detail page, and asserting that content from the API renders correctly on each page.

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

---

## Marketing & Lifecycle

### #83 · Gated download CTA for white papers
**Depends on:** —

White paper detail pages currently offer a plain download button. For lead generation, high-value white papers should require a visitor's name and email before delivering the file. On form submission the API creates a submission record (same `submissions` table used by contact and intake forms), sends the visitor a time-limited secure download link by email, and surfaces the submission in the admin alongside other form responses. Non-gated items keep their existing direct-download behavior. The admin collateral editor gains a "Require email to download" toggle that enables gating per item.

### #85 · Upcoming webinar registration rail
**Depends on:** —

Every webinar in the collateral library is currently treated as a past on-demand recording. This task adds an "upcoming" state: webinar records gain a `scheduled_at` date and an optional external `registration_url`. When a webinar is upcoming the detail page shows the event date and a registration CTA instead of a video player; the webinar index gains an "Upcoming" section above the on-demand grid. If no external URL is provided, an inline name/email form creates a submission record and sends a confirmation email with an .ics calendar invite attachment. Once the scheduled date passes, items revert automatically to on-demand behavior.

### #86 · Fix OG tags for social link previews
**Depends on:** —

When the site URL is shared on LinkedIn, Slack, or similar platforms, no title, image, or description appears. The OG tag logic exists in the React app but runs via JavaScript — social crawlers never see it. The fix is to embed default OG tags in the static HTML shell and add a crawler-detection middleware on the API server that injects page-specific title, description, and image for known social bots. Includes a dynamic sitemap endpoint and a Sitemap: directive in robots.txt.

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

---

## Public Site UX

### #84 · Seed & verify 301 redirects from Wix
**Depends on:** —

When the site migrated from Wix most content paths changed, so visitors following old links and Google's crawl index hit 404s. The redirect infrastructure (DB table, Express middleware, admin UI) is already in place. This task seeds the redirect table from three sources — the exported Wix redirect CSV (96 active rules), 53 additional rules identified by sitemap analysis, and 7 rules for pages not being rebuilt — then spot-checks that all source paths return HTTP 301 to the correct destination in the production environment.

### #133 · Constellation interactive demo sandbox on /applications/constellation
**Depends on:** — (additive on the public site); optional pairing with #128 (OAuth) if we eventually link the demo to a real free tier

The Constellation product page (`/applications/constellation`, sourced from `artifacts/synozur/src/data/applications.ts`) currently sells the AI Consulting Delivery Platform with copy + still images, the same way the other five apps are presented. For a delivery platform whose differentiator is the *feel* of AI-synthesized status reports and proactive risk surfaces, this is the weakest part of the funnel — prospects can't experience the product without booking a demo, and the demo bar is high. This task ships a **guided, sandboxed in-page demo** that lets a visitor experience three or four canonical Constellation moments without leaving the marketing site:
1. A realistic project dashboard (pre-seeded sample data — fake client, real-looking timelines, deliverables, risks).
2. The AI executive narrative ("here's what changed this week") rendered live, generated server-side from the seed data via Claude on first load and cached.
3. A risk drill-down that walks the visitor through how Constellation surfaces a slipping deliverable.
4. A simulated "send to Outlook" CTA that completes inline (no real email sent) so the visitor sees the Microsoft 365 integration story without auth.
Implementation: new `artifacts/synozur/src/components/demos/constellation/` module with a step-driven controller (URL-routable steps so we can deep-link from ads to a specific moment). Server-side: a small `/api/demos/constellation/narrative` endpoint that takes a seed id and returns a cached AI-generated narrative — keyed so we never regenerate per-visit. The interaction telemetry feeds into the experimentation framework (#140) and the HubSpot timeline (#131) — clicking through all four moments emits a high-intent `synozur_application_demo_requested` event with `app=constellation, depth=full`. Out of scope: a real free-tier login (still gated by the contact form), demos for the other five applications (apply the pattern in follow-up tasks once Constellation proves the format).

### #134 · "Ask Synozur" — RAG-powered Q&A across a curated grounding document set
**Depends on:** — (data is already in the CMS); pairs with #122 (multi-resource attachments give richer source material) and #131 (intent capture)

The site has accumulated a real corpus of editorial content — Insights posts, Polaris episode notes, white papers, case studies, FAQ — but visitors can only find it by browsing or search-by-title. They can't ask the corpus questions like "what does Synozur recommend for AI rollouts in financial services?" or "have you done a Constellation engagement in the public sector?" and get a grounded, cited answer. This task adds a **retrieval-augmented Q&A surface** on top of existing content, modeled on the **Vega grounding-document pattern** — editors explicitly designate which artifacts are part of the answer corpus rather than treating "everything published" as the implicit grounding boundary. Scope:

- **Grounding document registry (Vega pattern).** New `grounding_documents` table (`id`, `source_kind`, `source_id`, `scope_tags jsonb` — audience class / sector / application, `priority smallint`, `freshness_window_days`, `excerpt_override text NULL`, `excluded_section_ids jsonb`, `status` — `active` / `draft` / `expired`, `added_by`, `added_at`, `expires_at`). Editors opt artifacts *into* the grounding set; `published` is necessary but not sufficient. A nightly job marks rows past `expires_at` or beyond `freshness_window_days` as `expired` and notifies the owning editor.
- **Embeddings.** Add `pgvector` to the Postgres schema and an `embeddings` table (`grounding_document_id`, `chunk_index`, `text`, `embedding vector(1536)`, `model_version`, `updated_at`). The backfill worker only chunks artifacts that appear in `grounding_documents` with `status='active'`, into ~500-token chunks, honoring `excluded_section_ids` so editors can carve out boilerplate or stale paragraphs. Re-embedding triggers on publish/update of the underlying artifact *and* on grounding-document edits (existing artifact lifecycle hooks make this clean).
- **Admin grounding UI.** New `/admin/insights/grounding` page lists every grounding document with status, last re-embedded timestamp, scope tags, freshness countdown, and a click-through to the source artifact. Editors can: add an artifact (Insights post, case study, white paper, FAQ entry, Polaris show-notes) via a picker; bulk-import the current published set as a one-time backfill; preview the chunked text exactly as the retriever sees it (the same "grounding documents" preview Vega exposes); override the excerpt; exclude specific sections; set `freshness_window_days`; and expire on demand. A "test query" sidecar runs an arbitrary question against the current corpus and shows which chunks were retrieved, which were cited, and which were dropped — so editors can debug coverage before visitors hit it.
- **Q&A endpoint.** `POST /api/insights/ask` takes a question + optional filter (audience class, sector tag, application tag), runs hybrid retrieval (vector + BM25 over `collateral.title/excerpt`) restricted to `status='active'` grounding documents, and produces a streaming, grounded answer via Claude with mandatory inline citations linking back to the source content. Retrieval respects `priority` as a tiebreaker and surfaces `excerpt_override` to the model when present. Refusal path returns a "we don't have published material on that — talk to a human?" CTA wired to the contact form.
- **Public surface.** New `/insights/ask` page with streaming responses, conversation history (session-scoped, not persisted unless the user authenticates), and per-answer source cards rendered in the same style as Vega's grounding-document cards. Also embedded as a discovery widget on the Insights index page.
- **Editorial telemetry.** Every question + retrieved sources + final answer is logged (with PII redaction on the question) so editors can see what the audience is actually asking and what content gaps that surfaces. Admin page under `/admin/insights/questions` shows top questions, click-through to sources, refusal rate, **a "grounding gap" report that flags questions whose top-retrieved chunks scored below a confidence threshold** (i.e. the corpus probably needs a new document), and a "create insight on this topic" shortcut.

Out of scope: open-ended chat memory across sessions, fine-tuning, multi-language Q&A (English first; revisit after #139), automated grounding-set curation (always editor-driven, matching Vega). Follow-up: pipe high-intent questions ("how do I buy / start") to the Polaris concierge in the Strategic Roadmap for a soft hand-off.

### #138 · Stop pillar overview pages from competing with service pages on Google
**Depends on:** #55 (services hierarchy public pages)

The route `/services-overview/:slug` and `/services/:slug` render overlapping content and metadata for the same service pillar, causing Google to treat them as duplicate pages and split ranking signals between them. This task resolves the cannibalization by adding a canonical URL hint on the overview pages pointing to the authoritative service-detail URL, adjusting on-page copy so each URL has a distinct, non-overlapping SEO purpose, and verifying the fix with a Coverage report check.

### #139 · Internationalization foundation (English baseline + one launch locale)
**Depends on:** — (architecture); pairs with #110 (some audience classes will skew geographically), #130 (theme assets may need locale variants)

Every public string and every editorial CMS field on the site is English-only today. Enterprise procurement in EU and APAC stalls on this even when the buying team speaks English. This task lays the **i18n foundation** without trying to translate the entire corpus on day one:
- **Code-side i18n.** Adopt FormatJS (`react-intl`) inside `artifacts/synozur` with a build-time message-extraction step. Every string in the codebase moves to a `messages` catalog keyed by namespace; `en` is the baseline. Locale-routed URLs (`/de/insights/...`, `/ja/applications/constellation`) with a transparent default for `en` to avoid breaking existing links.
- **Content-side i18n.** Add a `locale` column + per-locale row strategy for translatable artifact fields on `collateral`, `services`, `solutions`, `case_studies`, `faq_items` — keyed (`canonicalId`, `locale`). The base row in `en` is canonical; per-locale rows are translations linked back. Admin UI gains a language switcher per editable field with a visible "translation lag" indicator (e.g. "EN updated 3 days after this DE translation").
- **Locale negotiation.** `Accept-Language` + explicit selector + persisted user preference (in `users.preferredLocale` for authenticated users, in localStorage for anon).
- **One launch locale.** Pick one (de or ja) for the first translation pass — translate the 30 highest-traffic public pages plus the four service pillars and the six application pages.
- **Translation workflow.** Integrate with Crowdin or Lokalise (decide during implementation) so external translators work in their native tooling rather than the admin UI; CI exports updated `messages.en.json`, fetches translated bundles, and writes them into `artifacts/synozur/src/locales/`.

Out of scope: right-to-left languages (separate pass), region-specific content (different case studies per locale — possible but not v1), multi-currency pricing. Follow-up: localize the Polaris concierge and the Insights Q&A (#134) once the editorial corpus has enough translated content to retrieve from.

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

### Polaris AI concierge — site-wide chat assistant
**Depends on:** #134 (reuses the curated grounding-document set + embeddings + Q&A pipeline as its retrieval layer); pairs with #131 (handoff to humans), maturity assessment above (deep-link into assessment)

The site has the **Polaris** brand (a podcast about transformation and the eponymous "north star" cosmic motif) — a natural fit for a conversational concierge. This initiative adds a persistent chat widget, branded as "Polaris," that helps visitors navigate the site and answers questions on the spot. Scope:
- Floating chat button in the lower-right of every public page (and inside the Galaxy portal once #135 ships, with deeper context).
- Backed by Claude with three tool integrations: (a) the Q&A retrieval layer from #134 for content questions, querying the same `grounding_documents`-restricted corpus so Ask Synozur and Polaris can never disagree about what counts as authoritative; (b) a `bookMeeting` tool that surfaces a Calendly-style scheduler; (c) a `submitContactForm` tool that fills the existing contact form on the visitor's behalf with their permission.
- Streaming responses with markdown + grounding-document source-card rendering identical to the Ask Synozur page (Vega pattern).
- A **concierge-specific scope filter** layered on top of the shared grounding set: editors can mark grounding documents as `concierge_eligible=false` (e.g. internal-history posts that work as deep-link reading material on `/insights/ask` but should not drive a sales chat), without removing them from the Ask Synozur corpus.
- Strict guardrails: refuse pricing speculation, refuse to commit Synozur to delivery, hand off to a human via the contact form whenever the visitor explicitly asks for one or the model's confidence drops.
- Cookie-consent gated; conversation transcripts (with PII redaction) saved when the visitor consents and surfaced to admins under `/admin/marketing/concierge` for review and content-gap mining — the same grounding-gap report from #134 picks up Polaris transcripts so editors see one unified view of what the corpus is missing.
- Rate-limited per IP and per session; abuse triggers a captcha and then a soft block.

Out of scope: voice mode, multi-language responses (#139 follow-up), agentic actions beyond the three tools above, a separate grounding-document set for the concierge (deliberately shared with #134; concierge-specific exclusions are the only divergence). Follow-up: integrate the maturity assessment so Polaris can steer relevant visitors into the assessment flow.

### Programmatic case-study drafts from Constellation engagement outcomes
**Depends on:** #128 (OAuth provider, so Constellation can talk back to this site as a registered client); pairs with consent workflow inside Constellation

Synozur runs more delivery work through Constellation (`scdp.synozur.com`) than the marketing team can write up — every engagement accumulates real artifacts (timeline adherence, risks burned down, hours saved, AI-synthesized executive narratives) that would make excellent case studies, but turning them into publishable copy today means a manual interview cycle weeks after the project closes. This initiative builds a **case-study drafting pipeline** that pulls anonymized Constellation outcomes into this site's CMS as `draft` rows for editor review. Scope: a new outbound API in Constellation publishes per-engagement summaries to `POST /api/cms/case-study-drafts` on this server (authenticated as a registered OAuth client per #128, with the `case_study.draft` scope); the endpoint validates the payload (project name, client display name, sector, summary metrics, key risks mitigated, timeline, anonymization flag), runs it through a draft-generation prompt against Claude (configurable model/version, prompt versioned in DB so we can A/B), and inserts a `draft` post into the existing `case_studies` table linked to the `collateral` artifact. Admin UI in `pages/admin/library/case-studies/` gains a "Generate from Constellation" button that lists eligible engagements (those with the client's marketing-consent flag set on the Constellation side), a side-by-side view of the raw outcome data and the generated draft, and an inline diff editor so the editor can refine before promoting to `scheduled` / `published`. A small audit trail records which Constellation engagement seeded which case study, the prompt + model version used, and the human edits applied — giving us both lineage and a feedback loop to improve the prompt. Out of scope: auto-publishing without human review (always-draft is a deliberate constraint), pulling testimonials directly from clients (separate consent workflow). Follow-up: extend to Polaris episode show-notes once the Polaris production pipeline matures.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| #56 | Let editors manage services and solutions in the admin | Content Library | #40 |
| #57 | Verify the new services pages with automated browser tests | Admin Access & People | #40 |
| #60 | Preview services and solutions before publishing | Content Library | #39, #56 |
| #61 | Track edit history for services and solutions | Content Library | #39, #56 |
| #66 | Preview a revision's content before restoring it | Content Library | #48 |
| #67 | Show a diff between the current version and a past revision | Content Library | #48 |
| #68 | Auto-trim old post revisions | Content Library | #48 |
| #75 | Bulk reorder featured library items via drag-and-drop | Content Library | #69 |
| #76 | Show a live preview of how a library item will appear on the public site | Content Library | #69 |
| #83 | Gated download CTA for white papers | Marketing & Lifecycle | — |
| #84 | Seed & verify 301 redirects from Wix | Public Site UX | — |
| #85 | Upcoming webinar registration rail | Marketing & Lifecycle | — |
| #86 | Fix OG tags for social link previews | Marketing & Lifecycle | — |
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
| #134 | "Ask Synozur" RAG-powered Q&A across a curated grounding document set | Public Site UX | — |
| #135 | Galaxy client portal — v0 | Admin Access & People | #110, #111, #128 |
| #136 | Verify remember-me sessions get the longer 30-day window when renewed | Admin Access & People | #133 |
| #137 | Cover the session garbage-collector and revocation helpers with tests | Admin Access & People | #133 |
| #138 | Stop pillar overview pages from competing with service pages on Google | Public Site UX | #55 |
| #139 | Internationalization foundation (English + one launch locale) | Public Site UX | — |
| #140 | Experimentation framework + conversion-funnel analytics | Marketing & Lifecycle | — |
| #141 | Partner & co-marketing portal | Admin Access & People | #110, #111, #128 |
| #144 | Add automated tests to confirm sign-up rate limiting works | Admin Access & People | #141 |
| #151 | Show spam comment count badge on the moderation navigation item | Content Library | #54 |
| #152 | Add Akismet integration to catch more spam automatically | Content Library | #54 |
| #153 | Make the spam rules settings page accessible to end-to-end automated testing | Content Library | #54 |
| — | Interactive maturity assessment replacing the static service-pillar pages | Strategic Roadmap | #131 |
| — | Polaris AI concierge — site-wide chat assistant | Strategic Roadmap | #134 |
| — | Programmatic case-study drafts from Constellation engagement outcomes | Strategic Roadmap | #128 |
