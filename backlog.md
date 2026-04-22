# Synozur Alliance — Product Backlog

> Last updated: April 22, 2026  
> 13 tasks pending · 73 merged · 29 cancelled

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

### #106 · Models: new DB-backed artifact type with library sync
**Depends on:** #98 (artifact-type pattern)

Maturity models (AI Maturity, KMMM, GTM Maturity, Content Management Maturity, Management / Company OS, and others added over time) currently live as Wix CMS rows — with one model already hand-entered into `collateralTable` today — and launch against separate sub-apps (`orion.synozur.com/…`, `aimaturity.synozur.com`). Editors cannot add, edit, or unpublish a model without a developer commit, and the richer Wix fields (`Long Description`, `Levels and Dimensions`, `Related Information`) don't fit the flat collateral shape. This task introduces a `modelsTable` on the #98 artifact pattern with: `title`, `slug`, `shortDescription`, `heroImage`, `longDescriptionHtml`, `dimensionsHtml`, `launchUrl` (external assessment app), `relatedInformation` jsonb, `status`, `publishedAt`, `unpublishedAt`, `featured` + `featuredRank`, SEO fields. Full admin CRUD, public `/models` gallery + `/models/:slug` detail page (with a prominent "Launch assessment →" CTA opening `launchUrl` in a new tab), and sync-to-collateral (`type="model"`, `url=/models/:slug`, internal) so models flow into the library and the featured carousel. One-shot seed script `seedModels.ts` reads the existing Wix CSV export and backfills historical records while reconciling the manually-entered library row by `sourceId`.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| #53 | Comment approval/reply notifications | Comments | #19 |
| #54 | CAPTCHA fallback for comment spam | Comments | #19 |
| #56 | CRUD for services & solutions in admin | Services admin | #40 |
| #57 | Playwright tests for services pages | QA | #40 |
| #60 | Preview unpublished services/solutions | Services admin | #39 |
| #61 | Edit history for services & solutions | Services admin | #39 |
| #62 | Bulk CSV import for services & solutions | Services admin | #39 |
| #63 | Asset categories beyond people/north-star | Library | #46 |
| #66 | Preview a past post revision | CMS | #48 |
| #67 | Diff between post revisions | CMS | #48 |
| #68 | Auto-trim old post revisions | CMS | #48 |
| #76 | Live card preview in library edit form | Library | #69 |
| #106 | Models: DB-backed artifact type + library sync | Heterogeneous CMS | #98 |
