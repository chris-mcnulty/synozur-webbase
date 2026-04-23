# SEO & Analytics Completion Plan

_Branch: `claude/plan-seo-analytics-169Qv`_

## Context

The site already has a mature SEO/analytics foundation: per-page meta tags
(`artifacts/synozur/src/lib/meta.tsx`), a page-type registry
(`artifacts/synozur/src/lib/seo-config.ts`), a dynamic `/sitemap.xml` +
`/robots.txt` (`artifacts/api-server/src/routes/seo.ts`), first-party
traffic analytics (`artifacts/synozur/src/lib/traffic-tracker.ts` +
`artifacts/api-server/src/routes/traffic.ts`), GA4/LinkedIn/Meta Pixel
loaders gated by cookie consent (`artifacts/synozur/src/components/analytics.tsx`),
SEO audit/autofill (`artifacts/api-server/src/lib/seoAudit.ts`), and a
search-engine submission helper (`artifacts/api-server/src/lib/seoSubmit.ts`).

The planning stub at `artifacts/synozur/src/pages/admin/marketing/seo.tsx`
lists seven controls that still need to be built. This document turns
that list into concrete work, adds the structured-data and analytics
gaps surfaced by research, and sequences them into shippable phases.

Out of scope for this plan: hreflang/i18n, server-side rendering, and
CDN cache-tag invalidation — revisit once the SPA adds locales or
moves off pure client rendering.

---

## Phase 1 — Database-backed SEO settings (foundation)

Goal: move every SEO/analytics dial that marketing currently needs a
redeploy to change into the `site_settings` row, keeping the env-var
path as fallback.

### 1.1 Schema

Extend `lib/db/src/schema/siteSettings.ts` with the columns below.
Generate a migration via drizzle-kit.

| Column | Type | Purpose |
|---|---|---|
| `seo_default_title_template` | `text` | e.g. `{page} | The Synozur Alliance`; falls back to the hard-coded template in `seo-config.ts` |
| `seo_default_description` | `text` | Used when a page doesn't supply its own description |
| `seo_default_og_image_asset_id` | `integer` FK `assets.id` | Fallback OG image; replaces hard-coded `/images/hero-bg.png` |
| `seo_twitter_handle` | `text` | Adds `twitter:site` / `twitter:creator` |
| `seo_twitter_card_type` | `text` | `summary` or `summary_large_image` (default) |
| `seo_linkedin_company_url` | `text` | Feeds Organization `sameAs` |
| `seo_google_site_verification` | `text` | Emits `<meta name="google-site-verification">` |
| `seo_bing_site_verification` | `text` | Emits `<meta name="msvalidate.01">` |
| `org_name` | `text` | Overrides hard-coded Organization name |
| `org_legal_name` | `text` |  |
| `org_logo_asset_id` | `integer` FK | Organization `logo` |
| `org_street_address` | `text` |  |
| `org_address_locality` | `text` |  |
| `org_address_region` | `text` |  |
| `org_postal_code` | `text` |  |
| `org_address_country` | `text` |  |
| `org_same_as` | `jsonb` (string[]) | `sameAs` URLs (LinkedIn, X, YouTube, etc.) |
| `tag_ga4_id` | `text` | Overrides `VITE_GA4_ID` |
| `tag_linkedin_partner_id` | `text` | Overrides `VITE_LINKEDIN_PARTNER_ID` |
| `tag_meta_pixel_id` | `text` | Overrides `VITE_META_PIXEL_ID` |
| `sitemap_excluded_paths` | `jsonb` (string[]) | Manual excludes |
| `sitemap_section_flags` | `jsonb` (`Record<section, boolean>`) | Toggle posts, collateral, services, solutions, team, events, applications, case-studies, models |

All columns are nullable; missing value ⇒ use the existing
env-var / hard-coded default. No behavior change on day one.

### 1.2 Zod / API surface (`lib/api-spec`, `lib/api-zod`)

- Extend `GetPublicSiteSettingsResponse` with only what the public site
  needs: the three tag IDs, the default OG image URL, the title
  template, default description, Twitter handle + card type, and the
  two verification tokens. Everything else stays admin-only.
- Extend `GetAdminSiteSettingsResponse` + `UpdateAdminSiteSettingsBody`
  with every new column. Validate lengths (title template ≤ 120,
  description ≤ 160), regex the verification tokens, and enforce
  `sameAs` entries are absolute URLs.

### 1.3 Server (`artifacts/api-server/src/routes/siteSettings.ts`)

- Extend `resolveImageUrls` to resolve `seo_default_og_image_asset_id`
  and `org_logo_asset_id`.
- Update both `GET` handlers and the `PATCH` to read/write every new
  column, with the same nullable trim-to-null behavior used for
  `polarisFeedUrl`.

Acceptance: migration applies cleanly; `GET /api/public-site-settings`
returns new fields with nulls; `PATCH /api/admin/site-settings` round-trips.

---

## Phase 2 — Admin UI: Marketing → SEO

Goal: replace the stub at `artifacts/synozur/src/pages/admin/marketing/seo.tsx`
with a real form, split into the seven sections from the stub plus the
structured-data editor.

### 2.1 Page structure

Mirror the patterns in `artifacts/synozur/src/pages/admin/site-config/site-settings.tsx`.
Use a single `useForm` + `react-hook-form` with the generated
`UpdateAdminSiteSettingsBody` schema. Section cards:

1. **Defaults** — title template, default description, default OG image
   (reuse the asset-picker from the home hero image fields).
2. **Social** — Twitter handle, card type select, LinkedIn company URL.
3. **Marketing tags** — GA4, LinkedIn Insight Partner, Meta Pixel. Show
   the env-var fallback greyed out when the DB value is empty so
   editors can see what's active.
4. **Search engine verification** — GSC token, Bing token. Link to the
   respective consoles in helper text.
5. **Sitemap** — section toggles (checkbox list) and a textarea for
   excluded paths (one per line, stored as `string[]`).
6. **Organization** — legal name, display name, logo asset picker,
   address fields, `sameAs` as a dynamic list of URL inputs.
7. **Status panel** — show `updatedAt` and a link to `/sitemap.xml` +
   `/robots.txt` for spot-checks.

### 2.2 Client plumbing

- Extend `api` client in `artifacts/synozur/src/lib/api.ts` (or whichever
  module owns `getAdminSiteSettings`) with the new fields; add a
  React Query mutation for the `PATCH`.
- Invalidate `["public-site-settings"]` on save so the live `Analytics`
  and `Meta` components pick up changes without a reload.

Acceptance: editing any field and saving updates the DB row; reloading
the public site reflects the change; form handles empty strings as null.

---

## Phase 3 — Wire the public site to DB settings

Goal: every place that currently reads an env var or hard-coded string
consults the `public-site-settings` payload first.

### 3.1 `Meta` component (`artifacts/synozur/src/lib/meta.tsx`)

- Read the public settings via the existing React Query key used by
  `Analytics`. Cache is already 60s.
- When a page doesn't pass `title`, apply the DB title template with
  page name substitution; otherwise keep current behavior.
- When a page doesn't pass `description`, fall back to the DB default.
- When a page doesn't pass `image`, fall back to the DB OG image URL;
  keep `/images/hero-bg.png` as last resort.
- Emit `<meta name="twitter:site">` / `<meta name="twitter:creator">`
  from the DB handle; honor card-type override.
- Emit `<meta name="google-site-verification">` and
  `<meta name="msvalidate.01">` once at the document level when tokens
  are set. These are site-wide, so render them in `Layout` rather than
  per-page.

### 3.2 `Analytics` component (`artifacts/synozur/src/components/analytics.tsx`)

- In `loadMarketingTags`, prefer `settings.tagGa4Id` / `tagLinkedInPartnerId`
  / `tagMetaPixelId` over `import.meta.env.*`.
- Keep the consent gate exactly as is.
- Defensive: if both DB and env are empty, skip that tag silently.

### 3.3 `OrganizationJsonLd` (`artifacts/synozur/src/components/organization-jsonld.tsx`)

- Replace the hard-coded object with DB values. Fall back to the
  current constants per-field so a partial config still renders valid
  schema.org.
- Render `sameAs` from the DB array (include LinkedIn URL automatically
  if provided in the Social section and not already in `sameAs`).

### 3.4 Sitemap (`artifacts/api-server/src/routes/seo.ts`)

- Load `siteSettingsTable` once per request.
- Skip content whose section flag is `false`.
- Filter out any URL that exact-matches an entry in
  `sitemap_excluded_paths`.
- Keep the existing 5-minute cache; invalidate on settings `PATCH` by
  lowering the `Cache-Control` window after a save (simplest: always
  honor 5min, editors see a short propagation delay — document this).

Acceptance: toggling the "include case studies" flag off causes
`/sitemap.xml` to omit every case-study URL within 5 minutes; adding a
Twitter handle in the admin shows up as a `twitter:site` tag after a
public-site reload.

---

## Phase 4 — Structured data enhancements

Goal: close the schema.org gaps called out in research. No admin UI in
this phase — these are automatic from existing content.

### 4.1 Breadcrumb schema

Add `artifacts/synozur/src/components/breadcrumb-jsonld.tsx`. Detail
pages already know their section (e.g. Services → slug); emit a
`BreadcrumbList` on every page whose `pageType` is in `DETAIL_PREFIXES`.
Integrate in each detail page alongside the existing `JsonLd` call, or
push the logic into `Meta` driven by `seo-config.ts` hierarchy.

### 4.2 Article schema on insights

`artifacts/synozur/src/pages/insights-post.tsx` (confirm filename) —
emit an `Article` schema with `headline`, `image`, `datePublished`,
`dateModified`, `author.@type=Person`, and `publisher` pointing at the
Organization. Pull fields from the post API payload already loaded.

### 4.3 Event schema on events

`artifacts/synozur/src/pages/events-detail.tsx` — emit `Event` schema
with `startDate`, `endDate`, `location`, `eventAttendanceMode`,
`organizer`.

### 4.4 Person schema on team members

If team-member detail pages exist (verify in `pages/team.tsx` + routes),
emit `Person` schema with `name`, `jobTitle`, `image`, `sameAs`.

Acceptance: Google's Rich Results Test passes for one URL of each new
schema type.

---

## Phase 5 — Analytics enhancements

Goal: make the first-party tracker more useful without adding cookies.

### 5.1 UTM parameter capture

- In `traffic-tracker.ts`, parse `utm_source/medium/campaign/term/content`
  from `window.location.search` on each route change and include them
  in the collect payload.
- Extend the traffic schema (`lib/db/src/schema/traffic.ts`) with five
  nullable `text` columns. Migration.
- Extend `POST /api/traffic/collect` body schema and handler.
- Update `classifySource()` in `artifacts/api-server/src/lib/traffic.ts`
  to prefer `utm_source` over referrer when present.
- Surface UTM breakdowns in the admin traffic overview
  (`artifacts/synozur/src/pages/admin/marketing/traffic.tsx`).

### 5.2 Custom event tracking

- Add a thin client helper `trackEvent(name, props?)` in
  `traffic-tracker.ts` that POSTs to `/api/traffic/event`.
- New table `traffic_events`: id, session_key, path, event_name,
  properties (jsonb), created_at.
- New admin view for top events grouped by name. Defer deep dashboards.
- Instrument the obvious set first: contact form submit, workshop
  detail CTA clicks, resource downloads (library/white-paper PDFs).

### 5.3 CSV export from the admin dashboard

`GET /api/cms/analytics/overview.csv` and `/sessions.csv` with the same
filters. Button in the traffic page opens the CSV for the current
filter state.

Acceptance: visiting `/?utm_source=linkedin&utm_campaign=q2-launch`
shows that campaign in the admin breakdown; submitting the contact
form creates one `form_submit` event.

---

## Phase 6 — Admin UI for existing SEO tooling

The audit and submit APIs exist with no frontend. Ship minimum UIs.

### 6.1 SEO audit panel

New page `artifacts/synozur/src/pages/admin/marketing/seo-audit.tsx`.
- Button: "Run audit" → `GET /api/seo/audit`.
- Table of findings grouped by artifact type (counts + list).
- Per-row "Apply autofill" that calls `POST /api/seo/audit/autofill`
  with that id. Bulk "Autofill all empty" at the top.
- Link each row to the matching CMS editor for manual fixes.

### 6.2 Indexing submit panel

Small card at the bottom of the SEO admin page:
- Textarea of URLs (prefilled with today's newly-published items from
  the sitemap endpoint, scoped to last 7 days).
- Submit button → `POST /api/seo/submit`.
- Show per-endpoint results (IndexNow / Google / Bing).
- Document the required env vars
  (`INDEXNOW_KEY`, `GOOGLE_INDEXING_*`, `BING_API_KEY`) in
  `docs/seo-env.md` and surface a "credentials missing" state when the
  server reports it.

Acceptance: editors can run audit + autofill without a shell; can push
a newly-published URL to search engines in one click.

---

## Sequencing & risk

| Phase | Est. PRs | Risk | Notes |
|---|---|---|---|
| 1 — Schema + API | 1 | Low | Purely additive, nullable columns |
| 2 — Admin form | 1 | Low | Isolated page |
| 3 — Public wiring | 1 | Medium | Touches `Meta`, `Analytics`, `OrganizationJsonLd`, sitemap route — regress-test with a published preview |
| 4 — Structured data | 1–2 | Low | Per-schema PRs; independent |
| 5.1 — UTM capture | 1 | Low | Additive schema |
| 5.2 — Custom events | 1 | Medium | New table; cap payload size to avoid PII leaks |
| 5.3 — CSV export | 1 | Low |  |
| 6 — Audit + submit UI | 1 | Low | Wraps existing endpoints |

Ship phases 1–3 first (unblocks marketing); phases 4–6 are independent
and can parallelize.

## Testing checklist per phase

- View-source a production-like build and diff `<head>` before/after.
- `curl /sitemap.xml | xmllint --noout -` to confirm validity.
- `curl /robots.txt` matches toggles.
- Google Rich Results Test for one URL of each schema type.
- Lighthouse SEO score ≥ 100 on home, an insight, a service, a
  case study.
- Manually verify the cookie-consent banner still gates GA4/LinkedIn/Meta
  when `requireCookieConsent` is on.
- Admin roundtrip: edit every field, save, reload public site,
  confirm in DOM / sitemap / network calls.

## Files touched (summary)

- `lib/db/src/schema/siteSettings.ts`, `lib/db/src/schema/traffic.ts` (+ new `trafficEvents.ts`)
- `lib/api-zod/*` site-settings + traffic schemas
- `artifacts/api-server/src/routes/siteSettings.ts`
- `artifacts/api-server/src/routes/seo.ts`
- `artifacts/api-server/src/routes/traffic.ts`
- `artifacts/api-server/src/routes/cms/traffic.ts`
- `artifacts/api-server/src/lib/traffic.ts`
- `artifacts/synozur/src/lib/meta.tsx`
- `artifacts/synozur/src/lib/seo-config.ts` (fallbacks only)
- `artifacts/synozur/src/lib/traffic-tracker.ts`
- `artifacts/synozur/src/components/analytics.tsx`
- `artifacts/synozur/src/components/organization-jsonld.tsx`
- `artifacts/synozur/src/components/breadcrumb-jsonld.tsx` (new)
- `artifacts/synozur/src/components/layout/index.tsx`
- `artifacts/synozur/src/pages/admin/marketing/seo.tsx` (rewrite)
- `artifacts/synozur/src/pages/admin/marketing/seo-audit.tsx` (new)
- `artifacts/synozur/src/pages/admin/marketing/traffic.tsx`
- Detail pages for article/event/person schema (`insights-post.tsx`,
  `events-detail.tsx`, `team.tsx`)
