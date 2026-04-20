# Synozur Alliance — Product Backlog

> Last updated: April 20, 2026  
> 21 tasks pending · 50 merged · 25 cancelled

Tasks are grouped by theme. Each entry includes the task reference, a plain-English description of what needs to be built, and which earlier work it depends on.

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

## Navigation & UI Polish

### #94 · Add a visual separator between Resources and Applications links in the dropdown
**Depends on:** #87 (Applications moved into Resources nav)

Following the merge of task #87, the Resources dropdown now contains two logical groups: the original resources links (Webinars, White Papers, Workshops, Browse Library) and the application links (Vega, Nebula, Constellation, Orion, Orbit, Zenith). There is no visual division between them. This task inserts a subtle `<hr>` or labelled divider between the two groups so visitors can scan the menu more easily.

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
