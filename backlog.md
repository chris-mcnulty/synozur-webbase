# Synozur Alliance — Product Backlog

> Last updated: April 21, 2026  
> 33 tasks pending · 50 merged · 25 cancelled

Tasks are grouped by theme. Each entry includes the task reference, a plain-English description of what needs to be built, and which earlier work it depends on.

## ★ Content Platform epic (#98–#105, highest priority)

A gap-analysis rewrite of the content layer. The goal is a single repeatable pattern for every artifact type (Insights, Collateral, Videos, White Papers, Workshops, Applications, Case Studies, Polaris episodes, plus future types like Offices) so editors can manage all content without a developer touching React components, and the public site can resolve related content via real foreign keys instead of string matching.

---

## Email & Subscriptions

### #34 · Let subscribers unsubscribe with one click
**Depends on:** #25 (confirmation emails)

When someone subscribes via the footer form, they receive a confirmation email. There is currently no way to opt out. This task adds a signed, one-click unsubscribe link to every email the system sends. Clicking the link marks the subscriber as opted-out in the database and shows a confirmation page. The admin submissions view should also surface their status. Required for CAN-SPAM / GDPR compliance before go-live.

---

## Comments

### #53 · Notify visitors when their comment is approved or replied to
**Depends on:** #19 (visitor comments)

When a visitor leaves a comment on an Insights post, they have no way of knowing when it is approved or when someone replies. This task sends a transactional email to the commenter's address at each of those moments. Visitors must opt-in (checkbox at comment time). The admin moderation queue gains a "send notification" toggle per comment. Uses the existing Resend email integration.

### #54 · Catch comment spam automatically with a CAPTCHA fallback
**Depends on:** #19 (visitor comments)

Bot-submitted comments currently pass through to the moderation queue, cluttering it. This task adds a CAPTCHA challenge (hCaptcha or Cloudflare Turnstile) on the comment form as a last line of defence after the existing Turnstile bot-protection layer. Invisible mode first; visible challenge as fallback on failure. Should integrate cleanly with the current `/api/comments` endpoint.

---

## SEO & Discoverability

### #55 · Make the new services pages discoverable on Google
**Depends on:** #40 (services pages refactor)

The redesigned services and solution detail pages were built without per-page meta tags or structured data. This task adds `<title>`, `<meta name="description">`, Open Graph, and Twitter card tags to every service overview, service detail, and solution detail page — pulling copy from the CMS record's `seo_title` and `seo_description` fields (adding those fields to the schema if missing). Also adds `application/ld+json` Service schema markup.

### #84 · 301 redirects from old Wix URLs
**Depends on:** nothing (standalone)

The site previously lived on Wix with URL patterns that differ from the new structure (e.g. `/post/slug` → `/insights/slug`, `/services/service-name` → `/services-overview/slug`). Without redirects, anyone who bookmarked the old site or followed a search result link hits a 404. This task creates a redirect map in the Express API server so that old Wix paths return HTTP 301 to the correct new path. The redirect table should be editable from the admin.

### #86 · Sitemap & OG tags for all public pages
**Depends on:** nothing (standalone)

Two related gaps:
1. **Sitemap** — generate `/sitemap.xml` dynamically from the Express server, listing all public routes (home, about, services, solutions, case studies, insights posts, library items, team, events, workshops). Ping Google Search Console on regeneration.
2. **OG / Twitter tags** — audit every public page route and ensure the `<Meta>` component is providing a page-specific title, description, and image. Pages currently missing them: `/clients`, `/partners`, `/workshops/:slug`, `/webinars/:slug`, `/team`, `/events`, `/applications/:slug`.

### #65 · Add a global search box in the site header
**Depends on:** #51 (live library content)

Visitors cannot search the site. This task adds a search input to the header (desktop: expands on click; mobile: full-screen overlay). The backend gains a `GET /api/search?q=` endpoint that queries insights posts, collateral items, services, and solutions full-text using PostgreSQL `tsvector`. Results are grouped by content type and displayed with a short excerpt and a link to the full page.

---

## Services & Solutions Admin

### #56 · Let editors manage services and solutions in the admin
**Depends on:** #40 (services pages refactor)

The admin panel has read-only views for services and solutions (imported via CSV). Editors need to be able to add, edit, and archive entries without developer intervention. This task wires up full CRUD for both entities in the existing admin UI: rich-text description, pillar/tag assignment, thumbnail upload, publish/draft toggle, and display-order control.

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

### #75 · Bulk reorder featured library items via drag-and-drop
**Depends on:** #69 (library live content)

The "From The Feed" home-page carousel and the library featured row are ordered by a numeric `featured_rank` column. Currently editors must edit each item individually to change the rank. This task adds a drag-and-drop reorder UI to the collateral admin list (filtered to featured items) that writes the new rank order in a single batch API call.

### #76 · Show a live preview of how a library item will appear on the public site
**Depends on:** #69 (library live content)

When editing a collateral item in the admin, editors cannot see how it will look in the public library card or the featured carousel. This task adds a "Preview card" panel beside the edit form that renders the `CollateralCard` component with the current (unsaved) field values, giving instant visual feedback before saving.

### #83 · Gated download CTA for white papers
**Depends on:** nothing (standalone)

White papers and eBooks in the library currently link out to external Wix-hosted PDFs. This task replaces that with a gated download flow: clicking "Download" on a white paper opens a modal asking for name and email; on submit the visitor receives a download link by email (via Resend) and the submission is logged in the admin. The actual PDF is stored in App Storage. Integrates with the existing submissions admin.

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

## Webinars

### #85 · Upcoming webinar registration rail
**Depends on:** nothing (standalone)

The `/webinars` page lists past and upcoming webinars from the collateral library, but there is no way for a visitor to register for an upcoming event. This task adds a registration rail to the webinar detail page (`/webinars/:slug`) for items with a future `published_at` date: a short form (name, email, company) that submits to the existing submissions endpoint with `type=webinar_registration` and sends a calendar invite via Resend. The admin submissions view should filter by this type.

---

## Heterogeneous CMS Artifacts

Follow-on work to the videos and white-papers CRUD shipped on the
`claude/add-crud-white-papers-videos-xug38` branch. Same pattern: dedicated
rich DB table per artifact type, full admin CRUD, public list + detail pages,
sync-to-collateral so items stay discoverable in the library.

### #95 · Migrate workshops from a static TS file to a DB-backed CMS table
**Depends on:** nothing (standalone)

Workshops currently live as a static TypeScript data file (`artifacts/synozur/src/data/workshops.ts`). Editors cannot add, edit, or unpublish a workshop without a developer commit. This task moves them to the same pattern videos and white papers now use: a `workshopsTable` with the full WorkshopOffers CSV schema (~50 columns covering hero, pain, scope, process, deliverables, diagnostic, competitive intel, outcomes, sample deliverables, FAQ, SEO, publish/unpublish dates), full admin CRUD, and sync-to-collateral. The existing `/workshops` and `/workshops/:slug` public pages keep their layout but read from the API instead of the static file. Includes a one-time migration script to seed the table from the current static data so no content is lost. Largest of the four artifact types — most fields and a data migration step.

### #96 · CRUD for applications (Project Comet, Vega, Nebula, etc.)
**Depends on:** nothing (standalone)

Applications have a CSV export but no DB table, no API, and no admin UI. This task adds an `applicationsTable` matching the Applications CSV schema (Name, Logo, Version, ReleaseDate, Description rich HTML, Screenshot, UserGuide URL, Tagline, WebMeta, Publish/Unpublish dates, Status), with admin CRUD and sync-to-collateral. The existing `/applications` and `/applications/:slug` public pages switch to reading from the new API. Smaller scope than #95 — flat schema, no nested sections.

### #97 · Editable parent-page hero & intro copy for resource list pages
**Depends on:** nothing (standalone)

Each resource list page (`/videos`, `/white-papers`, `/workshops`, `/applications`, `/insights`, `/case-studies`, `/library`, `/items`, `/webinars`) currently has its hero headline, intro paragraph, and SEO copy hardcoded in the React component. Editors cannot change them without a developer commit. This task adds a `content_parent_pages` table keyed by route slug, with hero headline, hero subhead, intro HTML, SEO title, SEO description, and OG image. Each list page reads its row at render time and falls back to the hardcoded defaults if missing. Admin gets a single "List page copy" screen showing all parent pages in a table with inline edit. Cross-cuts every artifact type and is a prerequisite for letting marketing iterate on parent-page messaging without a deploy.

---

## Navigation & UI Polish

### #94 · Add a visual separator between Resources and Applications links in the dropdown
**Depends on:** #87 (Applications moved into Resources nav)

Following the merge of task #87, the Resources dropdown now contains two logical groups: the original resources links (Webinars, White Papers, Workshops, Browse Library) and the application links (Vega, Nebula, Constellation, Orion, Orbit, Zenith). There is no visual division between them. This task inserts a subtle `<hr>` or labelled divider between the two groups so visitors can scan the menu more easily.

---

## Content Platform (gap analysis)

### #98 · Repeatable artifact-type pattern (Content Platform foundation)
**Depends on:** nothing (standalone)

There is no convention for adding a new content type. Shipping a small new surface — e.g. "Offices" for the About page — today requires hand-writing ~6 files (Drizzle table, API route module, sync-to-collateral helper, admin CRUD screen, public list page, public detail page) with each artifact type (`videos`, `white_papers`, `workshops`) diverging in naming, column sets, status enums, and timestamp handling. This task defines a shared "artifact base" module: a reusable column set (id/slug/title/status/publishedAt/featured/featuredRank/sourceId/active/createdAt/updatedAt/deletedAt + SEO fields), a route factory that mounts the standard list/detail/admin-CRUD endpoints given a table and a serializer, and a sync-to-collateral helper that works for any artifact table exposing the base columns. New artifact types should be addable by declaring the domain-specific columns, passing the table into the factory, and registering the sync callback — not by copying 400 lines of boilerplate.

### #99 · Polymorphic taxonomy (categories & tags on any content type)
**Depends on:** nothing (standalone)

`categoriesTable` and `tagsTable` exist but their join tables (`post_categories`, `post_tags`) reference `posts` only. Videos, white papers, workshops, case studies, applications, and Polaris episodes cannot carry taxonomy through the shared vocabulary — each currently keeps its own `tags` jsonb column or a string `pillar`, which means an editor tagging a video as "Azure" and a post as "Azure" produces no relationship. This task introduces polymorphic join tables `entity_categories(entity_type, entity_id, category_id)` and `entity_tags(entity_type, entity_id, tag_id)` where `entity_type` is an enum over the artifact tables. Existing `post_categories` / `post_tags` rows are migrated into the new tables and the old tables are dropped. The admin gains a shared "Taxonomy" picker reused across every artifact edit screen. A `GET /api/taxonomy/tags/:slug/entities` endpoint lists everything tagged with a given tag, grouped by entity type — the foundation for tag-landing pages.

### #100 · FK from collateral to services & solutions
**Depends on:** nothing (standalone)

The collateral table has no foreign key to `services` or `solutions`. Filtered content rails on `/services/:slug` and `/solutions/:slug` are currently approximated by string-matching on `pillar` values (see `PILLAR_BY_SLUG` in `service-detail.tsx`) and `tags` jsonb lookups — fragile, case-sensitive, and silently wrong when an editor renames a service. This task adds nullable `service_id` and `solution_id` columns to `collateralTable` (with indexes) plus a many-to-many `collateral_services` join table for items that belong to multiple services. Sync-to-collateral from videos / white papers / workshops resolves pillar → service row and writes the FK. Public rails (`GET /api/collateral?serviceId=…` and `?solutionId=…`) replace the pillar heuristic.

### #100.5 · Ship the #98/#99/#100 schema to dev + backfill + admin UI
**Depends on:** #98, #99, #100

Follow-up to the Content Platform foundation commit. The schema changes for #98-#100 landed in code but were not applied to the database, no data was migrated into the new polymorphic tables, and the admin UI has no way to use the new fields yet. This task closes the loop: (1) generate and apply the Drizzle migration (`pnpm --filter @workspace/db run push`) for the new columns (`collateral.service_id`, `collateral.solution_id`), the new tables (`entity_categories`, `entity_tags`, `collateral_services`), and the new enums (`artifact_status`, `taxonomy_entity_type`); (2) write a one-shot backfill script that copies `post_categories` → `entity_categories` and `post_tags` → `entity_tags` so existing post taxonomy is visible to the polymorphic readers, then a follow-on that deletes the legacy join tables once all callers are migrated; (3) add a shared `TaxonomyPicker` admin React component that reads/writes via the polymorphic endpoints and wire it into the post / video / white paper / workshop edit forms; (4) add a `ServiceSelect` + `SolutionSelect` pair to the collateral admin edit form that writes the new FKs; (5) switch the `/services/:slug` and `/solutions/:slug` rail queries from pillar/tag heuristics to `?serviceId=` / `?solutionId=` (prerequisite check for #105).

### #101 · Polaris episodes: from inline array to DB + RSS feed
**Depends on:** #98 (artifact-type pattern)

Polaris podcast episodes are currently an inline array inside `artifacts/synozur/src/pages/polaris.tsx` — no admin, no way to add a new episode without a developer commit, no syndication. This task moves them to a `polaris_episodes` table built on the #98 artifact-type pattern (episode number, title, summary, guest name, audio URL, duration, transcript HTML, published date, artwork), adds admin CRUD, serves `/api/polaris/episodes`, and exposes a valid iTunes-spec RSS 2.0 feed at `/polaris/rss.xml` so the podcast can be submitted to Apple / Spotify / Amazon Music.

### #102 · Case studies: from 633-line static TS file to DB
**Depends on:** #98 (artifact-type pattern), #99 (polymorphic taxonomy), #100 (FK to services/solutions)

Case studies live as a 633-line static TypeScript data file (`artifacts/synozur/src/data/case-studies.ts`). Editors cannot publish a new case study without a developer commit, and the file is large enough that merge conflicts are common. This task moves them to a `case_studies` table using the #98 pattern, with client name, industry, pillar, challenge/approach/outcome HTML sections, quote + attribution, hero image, logo, and FK to the related service/solution (#100). Taxonomy (#99) lets a case study be discoverable from the tag landing page. Sync-to-collateral so case studies appear in the unified library. One-time migration script seeds the table from the existing static file.

### #103 · Applications: from static TS file to DB (supersedes #96)
**Depends on:** #98 (artifact-type pattern)

Applications (Vega, Nebula, Constellation, Orion, Orbit, Zenith, Holidays & Birthdays Web Part) live as a 143-line static TypeScript data file duplicated between the header Resources nav and the sitemap. Adding, renaming, or removing an application currently requires edits in at least three places. This task (superseding #96 which only covered CRUD without the duplication fix) moves applications to an `applications` table on the #98 pattern, plus a single source of truth that the header nav, footer, sitemap, and `/applications` page all consume from one API endpoint. Admin CRUD with status fields, release date, tagline, rich description, screenshot, and user-guide URL.

### #104 · Editable About values, testimonials, and partner descriptions
**Depends on:** #97 (editable parent-page copy)

The About page values block, the client testimonials on `/clients`, and the partner descriptions on `/partners` are hardcoded JSX inside React components. Marketing cannot tweak copy, swap a testimonial, or add a new partner without a developer commit. This task introduces three small DB-backed tables — `about_values`, `client_testimonials`, `partner_descriptions` — each with display-order, active toggle, and admin CRUD. The three pages read at render time and fall back to the current hardcoded defaults if the table is empty, so we can migrate incrementally.

### #105 · Delete `PILLAR_BY_SLUG` / `WORKSHOP_CATEGORIES_BY_SLUG` lookup maps
**Depends on:** #100 (FK from collateral to services/solutions)

Once #100 provides real foreign keys and tag-based filtering (#99) is live, the hand-maintained `PILLAR_BY_SLUG` map in `artifacts/synozur/src/pages/service-detail.tsx` and the `WORKSHOP_CATEGORIES_BY_SLUG` map in the workshops area become obsolete and wrong — they are a source of silent regressions when services are renamed or added. This task deletes both maps and the string-matching code that uses them, switches filtered rails to query by `serviceId` / `solutionId` / `tagSlug`, and adds an ESLint rule that fails the build if either constant name reappears.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| #34 | Unsubscribe link in emails | Email | #25 |
| #53 | Comment approval/reply notifications | Comments | #19 |
| #54 | CAPTCHA fallback for comment spam | Comments | #19 |
| #55 | SEO meta for services pages | SEO | #40 |
| #56 | CRUD for services & solutions in admin | Services admin | #40 |
| #57 | Playwright tests for services pages | QA | #40 |
| #60 | Preview unpublished services/solutions | Services admin | #39 |
| #61 | Edit history for services & solutions | Services admin | #39 |
| #62 | Bulk CSV import for services & solutions | Services admin | #39 |
| #63 | Asset categories beyond people/north-star | Library | #46 |
| #65 | Global site search | Discovery | #51 |
| #66 | Preview a past post revision | CMS | #48 |
| #67 | Diff between post revisions | CMS | #48 |
| #68 | Auto-trim old post revisions | CMS | #48 |
| #75 | Drag-and-drop featured item reorder | Library | #69 |
| #76 | Live card preview in library edit form | Library | #69 |
| #83 | Gated PDF download for white papers | Library / Leads | — |
| #84 | 301 redirects from old Wix URLs | SEO | — |
| #85 | Webinar registration rail | Webinars | — |
| #86 | Sitemap.xml & OG tags audit | SEO | — |
| #94 | Separator in Resources dropdown | Navigation | #87 |
| #95 | Workshops: static TS → DB-backed CMS | Heterogeneous CMS | — |
| #96 | CRUD for applications | Heterogeneous CMS | — |
| #97 | Editable parent-page copy for list pages | Heterogeneous CMS | — |
| #98 | ★ Repeatable artifact-type pattern | Content Platform | — |
| #99 | ★ Polymorphic taxonomy across content types | Content Platform | — |
| #100 | ★ FK from collateral to services/solutions | Content Platform | — |
| #100.5 | Ship #98/#99/#100 schema to dev + backfill + admin UI | Content Platform | #98, #99, #100 |
| #101 | Polaris episodes → DB + RSS | Content Platform | #98 |
| #102 | Case studies static TS → DB | Content Platform | #98, #99, #100 |
| #103 | Applications static TS → DB (supersedes #96) | Content Platform | #98 |
| #104 | Editable About values / testimonials / partners | Content Platform | #97 |
| #105 | Delete `PILLAR_BY_SLUG` / `WORKSHOP_CATEGORIES_BY_SLUG` | Content Platform | #100 |
