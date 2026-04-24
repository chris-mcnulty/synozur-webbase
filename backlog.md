# Synozur Alliance — Product Backlog

> Last updated: April 24, 2026  
> 9 tasks pending · 90 merged · 29 cancelled

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
