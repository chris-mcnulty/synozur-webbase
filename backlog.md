# Synozur Alliance — Product Backlog

> Last updated: April 23, 2026  
> 21 tasks pending · 75 merged · 29 cancelled

Tasks are grouped by theme. Each entry includes the task reference, a plain-English description of what needs to be built, and which earlier work it depends on.

---

## Comments

### #53 · Notify visitors when their comment is approved or replied to
**Depends on:** #19 (visitor comments)

When a visitor leaves a comment on an Insights post, they have no way of knowing when it is approved or when someone replies. This task sends a transactional email to the commenter's address at each of those moments. Visitors must opt-in (checkbox at comment time). The admin moderation queue gains a "send notification" toggle per comment. Uses the existing Resend email integration.

### #54 · Catch comment spam automatically with a CAPTCHA fallback
**Depends on:** #19 (visitor comments)

Bot-submitted comments currently pass through to the moderation queue, cluttering it. This task adds a CAPTCHA challenge (hCaptcha or Cloudflare Turnstile) on the comment form as a last line of defence after the existing Turnstile bot-protection layer. Invisible mode first; visible challenge as fallback on failure. Should integrate cleanly with the current `/api/comments` endpoint.

---

## Services & Solutions Admin

### #57 · Verify the new services pages with automated browser tests
**Depends on:** #40 (services pages refactor)

The services hierarchy is the most commercially critical part of the site. This task writes Playwright end-to-end tests covering: home → Services nav → services overview page → service detail → solution detail, verifying content renders and links resolve. Tests run in CI so regressions are caught before merge.

### #60 · Preview services and solutions before publishing
**Depends on:** #39 (services hierarchy admin UI)

Editors currently have to publish a service or solution to see how it renders. This task adds a "Preview" button to the service and solution edit forms that opens the public-facing detail page in a new tab with a signed preview token, bypassing the `published` check. The preview token expires after 24 hours.

### #61 · Track edit history for services and solutions
**Depends on:** #39 (services hierarchy admin UI)

Like the post revision system (#48), services and solutions should record a snapshot whenever an editor saves a change, with the editor's name and a timestamp. The admin edit form shows a collapsible history panel. Restoring a revision replaces the current record's fields with the snapshot values (the current state is saved as a new revision before overwriting).

### #62 · Bulk import services and solutions from a spreadsheet
**Depends on:** #39 (services hierarchy admin UI)

Currently the services and solutions data can only be updated row-by-row through the admin edit form or by re-running the seed script. This task adds a CSV/XLSX upload endpoint (`POST /api/admin/services/import` and `/solutions/import`) and a drag-and-drop import UI in the admin, with a column-mapping step and a dry-run preview before commit. Useful for quarterly content refreshes.

---

## Content Library

### #63 · Add asset categories beyond people and north-star
**Depends on:** #46 (home page image picker)

The asset library currently only supports two categories (`people` and `north-star`), which drive the two home-page image pickers. This task extends the category enum (and the image picker UI) to support additional buckets — for example `abstract`, `event`, `product-screenshot` — so that assets uploaded for other purposes (e.g. collateral hero images, workshop thumbnails) can be browsed by category rather than scrolled through as one flat list.

### #76 · Show a live preview of how a library item will appear on the public site
**Depends on:** #69 (library live content)

When editing a collateral item in the admin, editors cannot see how it will look in the public library card or the featured carousel. This task adds a "Preview card" panel beside the edit form that renders the `CollateralCard` component with the current (unsaved) field values, giving instant visual feedback before saving.

---

## CMS / Post Editor

### #66 · Preview a revision's content before restoring it
**Depends on:** #48 (post revisions)

The revision history panel shows a list of past snapshots with dates and author names. Editors cannot currently read the content of a past revision without restoring it (which overwrites the current draft). This task adds a "Preview" link beside each revision that opens a read-only rendered view of that snapshot in a slide-over panel or new tab.

### #67 · Show a diff between the current version and a past revision
**Depends on:** #48 (post revisions)

Related to #66. Rather than previewing a revision in isolation, editors often want to see exactly what changed. This task renders a word-level diff between the selected revision and the current version of the post, highlighting additions in green and deletions in red, using a library such as `diff-match-patch`.

### #68 · Automatically trim old revisions to keep storage lean
**Depends on:** #48 (post revisions)

Every save creates a new revision. Without a retention policy, the `post_revisions` table grows indefinitely. This task adds a scheduled job (daily cron) that deletes revisions older than 90 days, keeping the 10 most recent regardless of age. The retention window and keep-count should be configurable via admin site settings.

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

---

## SEO & Analytics

The site already has per-page meta tags (`artifacts/synozur/src/lib/meta.tsx`), a page-type registry (`artifacts/synozur/src/lib/seo-config.ts`), a dynamic `/sitemap.xml` + `/robots.txt` (`artifacts/api-server/src/routes/seo.ts`), first-party traffic analytics, GA4/LinkedIn/Meta Pixel loaders gated by cookie consent, and a SEO audit/autofill + search-engine submission backend. The planning stub at `artifacts/synozur/src/pages/admin/marketing/seo.tsx` lists seven controls that still need to ship; the tasks below turn that list into concrete work and add the structured-data and analytics gaps surfaced by research. Phases 1–3 are the critical path (they unblock marketing); #115–#117 are independent and can parallelize.

### #112 · Database-backed SEO & analytics settings (schema + API)
**Depends on:** — (foundation)

Move every SEO/analytics dial marketing currently needs a redeploy to change into the `site_settings` row, keeping env vars as fallback. Extend `lib/db/src/schema/siteSettings.ts` with nullable columns for: default title template, default meta description, default OG image (asset FK), Twitter handle + card type, LinkedIn company URL, Google + Bing site-verification tokens, Organization fields (name, legal name, logo asset FK, address parts, `sameAs` as jsonb), marketing tag IDs (GA4, LinkedIn Insight Partner, Meta Pixel), and sitemap controls (`excluded_paths` jsonb, `section_flags` jsonb). Generate a drizzle migration. Extend `GetPublicSiteSettingsResponse` with only what the public site needs (tag IDs, OG image URL, title template, default description, Twitter handle + card type, verification tokens); extend `GetAdminSiteSettingsResponse` + `UpdateAdminSiteSettingsBody` with every new column (validate title ≤ 120, description ≤ 160, `sameAs` entries are absolute URLs). Update `artifacts/api-server/src/routes/siteSettings.ts` to resolve both new asset FKs and read/write every new column with the same nullable trim-to-null behavior used for `polarisFeedUrl`. Purely additive — no behavior change on day one.

### #113 · Admin UI for Marketing → SEO settings
**Depends on:** #112

Replace the stub at `artifacts/synozur/src/pages/admin/marketing/seo.tsx` with a real form mirroring `artifacts/synozur/src/pages/admin/site-config/site-settings.tsx`: single `useForm` + `react-hook-form` using the generated `UpdateAdminSiteSettingsBody` schema. Seven section cards — Defaults (title template, default description, default OG image asset picker), Social (Twitter handle, card type select, LinkedIn company URL), Marketing tags (GA4, LinkedIn, Meta Pixel with env-var fallback shown greyed out), Search engine verification (GSC + Bing tokens with links to their consoles), Sitemap (section toggles + excluded-paths textarea), Organization (legal name, display name, logo asset picker, address, dynamic `sameAs` URL list), and Status (showing `updatedAt` + links to `/sitemap.xml` and `/robots.txt`). Invalidate the `["public-site-settings"]` query on save so live `Analytics` and `Meta` components pick up changes without a reload.

### #114 · Wire the public site to the new DB settings
**Depends on:** #112

Every place that reads a hard-coded string or env var consults the `public-site-settings` payload first, with the current constants as fallback so a partial config still renders valid output. In `artifacts/synozur/src/lib/meta.tsx`: apply the DB title template when a page doesn't pass a title; fall back to DB default description + OG image; emit `twitter:site`/`twitter:creator` from the DB handle; honor DB card type. In `artifacts/synozur/src/components/layout/index.tsx`: render `google-site-verification` and `msvalidate.01` meta tags once site-wide when tokens are set. In `artifacts/synozur/src/components/analytics.tsx` — in `loadMarketingTags`, prefer `settings.tagGa4Id` / `tagLinkedInPartnerId` / `tagMetaPixelId` over `import.meta.env.*`; keep the consent gate untouched. In `artifacts/synozur/src/components/organization-jsonld.tsx`: replace the hard-coded object with DB values, falling back to current constants per-field; render `sameAs` from the DB array. In `artifacts/api-server/src/routes/seo.ts`: skip content whose section flag is `false` and filter URLs matching `sitemap_excluded_paths`. Document the 5-minute sitemap cache propagation delay.

### #115 · Structured-data enhancements (Breadcrumb, Article, Event, Person)
**Depends on:** — (independent of #112–#114)

Close the schema.org gaps surfaced by research. Add `artifacts/synozur/src/components/breadcrumb-jsonld.tsx` and emit `BreadcrumbList` on every page whose `pageType` is in `DETAIL_PREFIXES` — drive the hierarchy from `seo-config.ts`. On the Insights detail page, emit an `Article` schema with `headline`, `image`, `datePublished`, `dateModified`, `author.@type=Person`, and `publisher` pointing at the Organization, using fields from the existing post API payload. On the events detail page, emit `Event` schema with `startDate`, `endDate`, `location`, `eventAttendanceMode`, `organizer`. If team-member detail pages exist, emit `Person` schema with `name`, `jobTitle`, `image`, `sameAs`. Acceptance: Google's Rich Results Test passes for one URL of each new schema type.

### #116 · Analytics enhancements (UTM capture, custom events, CSV export)
**Depends on:** — (independent; extends existing traffic system)

Three additive improvements to the first-party tracker without adding cookies. (a) UTM parameter capture — parse `utm_source/medium/campaign/term/content` from `window.location.search` in `artifacts/synozur/src/lib/traffic-tracker.ts` and include in the collect payload; add five nullable `text` columns to `lib/db/src/schema/traffic.ts`; prefer `utm_source` over referrer in `classifySource()`; surface UTM breakdowns in `artifacts/synozur/src/pages/admin/marketing/traffic.tsx`. (b) Custom event tracking — add `trackEvent(name, props?)` helper posting to `POST /api/traffic/event`; new `traffic_events` table (id, session_key, path, event_name, properties jsonb, created_at); admin view showing top events grouped by name; instrument contact-form submit, workshop detail CTA clicks, and resource downloads first. (c) CSV export — `GET /api/cms/analytics/overview.csv` and `/sessions.csv` honoring the same filters; download button on the traffic page scoped to current filter state.

### #117 · Admin UI for existing SEO audit + search-engine submit endpoints
**Depends on:** — (wraps shipped APIs)

The `/api/seo/audit`, `/api/seo/audit/autofill`, and `/api/seo/submit` endpoints exist with no frontend. New page `artifacts/synozur/src/pages/admin/marketing/seo-audit.tsx` with a "Run audit" button that calls `GET /api/seo/audit` and renders findings grouped by artifact type (counts + list), a per-row "Apply autofill" calling `POST /api/seo/audit/autofill` with that id, a bulk "Autofill all empty" control, and links from each row back to the matching CMS editor for manual fixes. Add a submission card on the SEO admin page with a URL textarea (prefilled with the last 7 days of newly-published items from the sitemap endpoint) and a submit button calling `POST /api/seo/submit`, showing per-endpoint results (IndexNow / Google / Bing). Surface a "credentials missing" state when the server reports it; document the required env vars (`INDEXNOW_KEY`, `GOOGLE_INDEXING_*`, `BING_API_KEY`) in `docs/seo-env.md`.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| #53 | Comment approval/reply notifications | Comments | #19 |
| #54 | CAPTCHA fallback for comment spam | Comments | #19 |
| #57 | Playwright tests for services pages | QA | #40 |
| #60 | Preview unpublished services/solutions | Services admin | #39 |
| #61 | Edit history for services & solutions | Services admin | #39 |
| #62 | Bulk CSV import for services & solutions | Services admin | #39 |
| #63 | Asset categories beyond people/north-star | Library | #46 |
| #66 | Preview a past post revision | CMS | #48 |
| #67 | Diff between post revisions | CMS | #48 |
| #68 | Auto-trim old post revisions | CMS | #48 |
| #76 | Live card preview in library edit form | Library | #69 |
| #108 | FAQ schema onto the shared artifact pattern | Heterogeneous CMS | #107 |
| #109 | Careers / HR module under /admin/people/careers | Admin Access & People | — |
| #110 | Expand user/role model to seven audience classes | Admin Access & People | #109 |
| #111 | Move role → capability map into the database | Admin Access & People | #110 |
| #112 | Database-backed SEO & analytics settings (schema + API) | SEO & Analytics | — |
| #113 | Admin UI for Marketing → SEO settings | SEO & Analytics | #112 |
| #114 | Wire the public site to the new DB settings | SEO & Analytics | #112 |
| #115 | Structured-data enhancements (Breadcrumb, Article, Event, Person) | SEO & Analytics | — |
| #116 | Analytics enhancements (UTM capture, custom events, CSV export) | SEO & Analytics | — |
| #117 | Admin UI for existing SEO audit + search-engine submit endpoints | SEO & Analytics | — |
