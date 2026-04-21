# Synozur Alliance — Product Backlog

> Last updated: April 21, 2026  
> 30 tasks pending · 58 merged · 25 cancelled

Tasks are grouped by theme. Each entry includes the task reference, a plain-English description of what needs to be built, and which earlier work it depends on.

---

## Gap Analysis

This section records the architectural findings that drove the April 2026 backlog revision.

### Stack divergence from original spec

The original specification called for **Next.js 14 + Payload CMS** with ~15 named CMS collections (posts, caseStudies, events, podcastEpisodes, webinars, whitepapers, workshops, models, applications, teamMembers, clients, partners, services, solutions, pages, navigation, siteSettings). The stack was later changed to **React + Vite + Express + Drizzle + PostgreSQL**. That swap is fine, but several collections were never migrated to DB-backed tables and instead landed as static TypeScript data files or hardcoded JSX:

| Content type | Where it lives today | Should be |
|---|---|---|
| Polaris podcast episodes | Inline array in `polaris.tsx` (~12 episodes) | `podcastEpisodesTable` + admin CRUD |
| Case studies | `src/data/case-studies.ts` (633 lines) | `caseStudiesTable` + admin CRUD |
| Applications | `src/data/applications.ts` (143 lines, duplicated in header nav + sitemap) | `applicationsTable` + admin CRUD |
| About / company values | Hardcoded JSX in `about.tsx` | CMS-editable page copy block |
| Client testimonials | Hardcoded array in `clients.tsx` | `clientTestimonialsTable` or reuse `siteSettings` |
| Partner logos & descriptions | Hardcoded in `partners.tsx` | `partnersTable` or `siteSettings` |
| List-page hero & intro copy | Hardcoded per component | `content_parent_pages` table (task #97) |

### Taxonomy is scoped to blog posts only

The `categoriesTable` and `tagsTable` in `lib/db/src/schema/taxonomy.ts` are joined exclusively to `postsTable` through `post_categories` and `post_tags`. No other content type — collateral, services, solutions, workshops, case studies, applications — can carry a category or tag. This means it is impossible today to answer queries such as "all white papers tagged AI Strategy" or "all content related to the Technology Transformation service" without hand-wiring slug-matching logic in React (which is exactly what `PILLAR_BY_SLUG` and `WORKSHOP_CATEGORIES_BY_SLUG` in `service-detail.tsx` do today).

### Service/solution cross-tagging on collateral is absent

The `collateralTable` has a `pillar` enum field (strategic / technology / experiences / gtm) and a freeform `tags` JSONB array. There are no foreign-key references to `servicesTable` or `solutionsTable`. The business need — "show me all blog posts / white papers relevant to the AI Strategy & Design solution" — cannot be fulfilled by a database query; it is approximated by `blogCategory` / `blogTag` text fields on the solution row that are matched string-by-string in the front end. This is fragile, not discoverable in the admin, and breaks any time a tag string changes.

### No scaffolding pattern for new content types

There is no registry, generator, or shared abstraction that encodes the repeating pattern of a CMS content type. Adding a hypothetical "Offices" object today would require hand-writing approximately six files: a Drizzle schema module, an Express router, an admin list page, an admin edit form, a public list page, and a public detail page — with no guarantee they follow the same conventions as prior types. Tasks #98–#105 below introduce a baseline pattern that future types can follow.

### Completed items removed from this revision

The following tasks shipped before this revision and have been moved to the merged count: **#55** (SEO meta for services pages), **#56** (CRUD for services & solutions in admin), **#63** (asset categories), **#75** (drag-and-drop featured item reorder), **#76** (live card preview in library edit form), **#84** (301 redirects from old Wix URLs), **#86** (sitemap.xml & OG tags), **#95** (workshops DB migration).

---

## ★ Content Platform (new — highest priority)

These items address the architectural gaps identified above. They should be sequenced before the remaining legacy items because they change the data model that later features depend on.

### #98 · Establish a repeatable CMS content-type pattern
**Depends on:** nothing (standalone)

Define a documented, code-level convention that every CMS content type must follow going forward. The convention covers: (a) a Drizzle schema module in `lib/db/src/schema/` with consistent use of uuid primary keys, `createdAt` / `updatedAt` / `deletedAt`, a `sourceId` for idempotent imports, and a `publishedAt` toggle; (b) a typed Express router in `artifacts/api-server/src/routes/` with list, detail, create, update, and soft-delete endpoints; (c) an admin list page and edit form in `artifacts/synozur/src/pages/admin/`; (d) public list and detail pages under `artifacts/synozur/src/pages/`; (e) a `syncCollateral` call so the item appears in the library. Document the pattern in `docs/content-type-guide.md` so that any developer (or coding agent) adding a new type — say, "Offices" — can follow the same checklist without inventing conventions. This is a meta-task; the output is documentation plus a worked example refactoring one existing type to the canonical pattern.

### #99 · Extend taxonomy (categories & tags) to all content types
**Depends on:** #98 (content-type pattern)

`categoriesTable` and `tagsTable` currently join only to `postsTable`. Extend the join tables so that any content type can carry categories and tags: add `collateral_categories`, `collateral_tags`, `workshop_categories`, `workshop_tags`, `case_study_categories`, `case_study_tags`, `application_categories`, `application_tags`, and `service_tags` / `solution_tags` junction tables (or a single polymorphic `content_tags` table keyed by `content_type` + `content_id` if you prefer). Update all relevant admin edit forms to show a tag/category picker. Update the public library filter UI to filter by taxonomy across all types. This is the foundational change that enables the cross-content filtered views the business needs.

### #100 · Cross-tag collateral to services and solutions
**Depends on:** #99 (unified taxonomy)

Add `collateral_services` and `collateral_solutions` junction tables so that any collateral item (white paper, video, insight, case study, webinar, etc.) can be explicitly linked to one or more services or solutions. In the admin collateral edit form, add a "Related services" and "Related solutions" multi-select. On the public service detail page (`/services/:slug`) and solution detail page (`/solutions/:slug`), replace the current hardcoded `PILLAR_BY_SLUG` / `WORKSHOP_CATEGORIES_BY_SLUG` React maps with a database query that fetches items cross-tagged to that service or solution. This eliminates the brittle slug-matching logic and makes the filtered content rail correct by data, not by code.

### #101 · Migrate Polaris podcast episodes from hardcoded TSX to DB-backed CMS
**Depends on:** #98 (content-type pattern)

Polaris podcast episodes are currently a plain TypeScript array inside `artifacts/synozur/src/pages/polaris.tsx`. Editors cannot publish a new episode without a code commit. This task adds a `podcastEpisodesTable` (episode number, title, slug, description, release date, duration, audio URL, Apple Podcasts URL, cover image, show notes rich HTML, SEO fields, publish/unpublish dates), full admin CRUD, and an RSS feed at `/polaris/rss.xml`. The existing `/polaris` and `/polaris/:slug` public pages switch to reading from the new API. Includes a one-time seed script from the existing inline data. Also syncs episodes to collateral as type `podcast` so they are discoverable in the library.

### #102 · Migrate case studies from static TS file to DB-backed CMS
**Depends on:** #98 (content-type pattern)

Case studies live in `artifacts/synozur/src/data/case-studies.ts` (633 lines). Editors cannot add, edit, or archive a case study without a developer commit. This task creates a `caseStudiesTable` (title, slug, client name, industry, engagement type, hero image, challenge HTML, approach HTML, outcomes HTML, pull quotes, related services/solutions, featured flag, SEO fields, publish dates), full admin CRUD, and sync-to-collateral. The existing `/case-studies` and `/case-studies/:slug` pages switch to reading from the API. One-time migration script to seed from the static file is required so no content is lost.

### #103 · Migrate applications from static TS file to DB-backed CMS
**Depends on:** #98 (content-type pattern)

Supersedes the scope of #96. Applications currently live as `artifacts/synozur/src/data/applications.ts` (143 lines) and are duplicated in the header navigation component and the sitemap. This task adds an `applicationsTable` matching the Applications CSV schema (name, logo, version, release date, description rich HTML, screenshot, user guide URL, tagline, SEO meta, publish/unpublish dates, status), full admin CRUD, sync-to-collateral, and an API endpoint that the header nav and sitemap consume instead of the static file. The existing `/applications` and `/applications/:slug` public pages switch to reading from the new API. Replaces #96.

### #104 · Make About, Clients, and Partners page copy CMS-editable
**Depends on:** nothing (standalone)

Three pages contain business-critical content that is fully hardcoded in React: `about.tsx` (company values, story sections), `clients.tsx` (client testimonials and quote carousel), and `partners.tsx` (partner logos and descriptions). Marketing cannot update any of this without a code deploy. This task adds: (a) an `about_content` block inside the existing `siteSettings` table, or a dedicated `pageContentBlocks` table keyed by page slug, covering values, story, and hero copy; (b) a `clientTestimonialsTable` for the quotes; (c) a `partnersTable` for logos and descriptions. Admin edit forms for all three. The public pages read from the API and fall back to hardcoded defaults if the DB row is absent, so the pages are never broken during migration.

### #105 · Remove hardcoded slug maps from service-detail.tsx
**Depends on:** #100 (service/solution cross-tagging on collateral)

`service-detail.tsx` contains two literal `Record<string, …>` maps — `PILLAR_BY_SLUG` and `WORKSHOP_CATEGORIES_BY_SLUG` — that control which collateral and workshops appear in each service's content rail. Any new service pillar or workshop category requires a code change. Once #100 is complete (collateral cross-tagged to services in the DB), replace these maps with an API call: the service detail endpoint should return the service's linked collateral and linked workshops directly, eliminating both maps and the fragile string-matching logic.

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

### #65 · Add a global search box in the site header
**Depends on:** #51 (live library content)

Visitors cannot search the site. This task adds a search input to the header (desktop: expands on click; mobile: full-screen overlay). The backend gains a `GET /api/search?q=` endpoint that queries insights posts, collateral items, services, and solutions full-text using PostgreSQL `tsvector`. Results are grouped by content type and displayed with a short excerpt and a link to the full page. Once #99 is complete, results should also be filterable by taxonomy.

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

### #97 · Editable parent-page hero & intro copy for resource list pages
**Depends on:** nothing (standalone)

Each resource list page (`/videos`, `/white-papers`, `/workshops`, `/applications`, `/insights`, `/case-studies`, `/library`, `/items`, `/webinars`) currently has its hero headline, intro paragraph, and SEO copy hardcoded in the React component. Editors cannot change them without a developer commit. This task adds a `content_parent_pages` table keyed by route slug, with hero headline, hero subhead, intro HTML, SEO title, SEO description, and OG image. Each list page reads its row at render time and falls back to the hardcoded defaults if missing. Admin gets a single "List page copy" screen showing all parent pages in a table with inline edit. Cross-cuts every artifact type and is a prerequisite for letting marketing iterate on parent-page messaging without a deploy.

---

## Navigation & UI Polish

### #94 · Add a visual separator between Resources and Applications links in the dropdown
**Depends on:** #87 (Applications moved into Resources nav)

Following the merge of task #87, the Resources dropdown now contains two logical groups: the original resources links (Webinars, White Papers, Workshops, Browse Library) and the application links (Vega, Nebula, Constellation, Orion, Orbit, Zenith). There is no visual division between them. This task inserts a subtle `<hr>` or labelled divider between the two groups so visitors can scan the menu more easily. Note: once #103 ships the application links will be sourced dynamically from the DB; the divider logic should survive that change.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| **#98** | **Repeatable CMS content-type pattern** | **Content Platform** | — |
| **#99** | **Unified taxonomy across all content types** | **Content Platform** | #98 |
| **#100** | **Cross-tag collateral to services & solutions** | **Content Platform** | #99 |
| **#101** | **Polaris podcast: hardcoded TSX → DB-backed CMS** | **Content Platform** | #98 |
| **#102** | **Case studies: static TS → DB-backed CMS** | **Content Platform** | #98 |
| **#103** | **Applications: static TS → DB-backed CMS** | **Content Platform** | #98 |
| **#104** | **About / Clients / Partners: hardcoded → CMS** | **Content Platform** | — |
| **#105** | **Remove PILLAR_BY_SLUG & WORKSHOP_CATEGORIES_BY_SLUG** | **Content Platform** | #100 |
| #34 | Unsubscribe link in emails | Email | #25 |
| #53 | Comment approval/reply notifications | Comments | #19 |
| #54 | CAPTCHA fallback for comment spam | Comments | #19 |
| #57 | Playwright tests for services pages | QA | #40 |
| #60 | Preview unpublished services/solutions | Services admin | #39 |
| #61 | Edit history for services & solutions | Services admin | #39 |
| #62 | Bulk CSV import for services & solutions | Services admin | #39 |
| #65 | Global site search | Discovery | #51 |
| #66 | Preview a past post revision | CMS | #48 |
| #67 | Diff between post revisions | CMS | #48 |
| #68 | Auto-trim old post revisions | CMS | #48 |
| #83 | Gated PDF download for white papers | Library / Leads | — |
| #85 | Webinar registration rail | Webinars | — |
| #94 | Separator in Resources dropdown | Navigation | #87 |
| #97 | Editable parent-page copy for list pages | Heterogeneous CMS | — |
