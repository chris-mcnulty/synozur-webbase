# No-Code Page Authoring + In-Place Editing — Implementation Plan

Status: **proposal**, May 2026. Companion to the Wix-platform-parity
backlog item in `BACKLOG.md`.

## Goal

Let non-developers create new public pages, compose them from a
predefined library of typed blocks, edit content in place on the live
site, and publish — without a deploy, and without giving up the
performance / accessibility / SEO guarantees that the hand-written
React surface gives us today.

**Non-goals.**

- A freeform pixel-level visual editor (the Wix Editor / Studio
  metaphor). That trades too much of our design-system, performance,
  and accessibility posture for marginal author flexibility.
- Per-block custom CSS. Blocks expose theme-bounded props.
- Real-time collaborative editing (à la Google Docs). Single-editor
  with optimistic concurrency is enough for the editorial team's size.
- Replacing every hand-coded page on day one. Existing components
  stay; pages opt in to the new model.

## What we already have

The plan below builds on existing primitives — there is meaningful
prior art:

- **Rich-text editor.** `RichTextEditor.tsx` (TipTap, with custom
  iframe / image / link / table extensions) is reused for any
  prose-bearing block.
- **Media picker.** `MediaPickerModal.tsx` is the canonical asset
  picker for any image / video field on a block.
- **Database revisions.** `revisionsTable` in
  `lib/db/src/schema/posts.ts` already snapshots post content — the
  same pattern applies one layer up to whole pages.
- **Editable hero / intro on list pages.** `content_parent_pages`
  proves out the slug-keyed editable-page idea on a small surface.
  It folds neatly into one Hero block + one Prose block under the new
  model and can be deprecated later.
- **Capability-based admin auth.** `useAdminAccess()` and the
  capabilities table (`access/capabilities`) already gate admin
  surfaces; we reuse `site.manage` (or add `pages.author` /
  `pages.publish`) for the new screens.
- **Audit log.** `cms/auditLog.ts` is the ready destination for every
  block create / update / publish event.
- **Drizzle migrations + Zod schemas.** Schema → typed API → typed
  client is the established pattern; the new tables follow the same
  pipeline.

## Scope by phase

### Phase 0 — data model + page renderer

New schema (under `lib/db/src/schema/pages.ts`):

```
pages
  id uuid pk
  slug text unique
  title text
  status enum(draft, scheduled, published, archived)
  layout_kind text                  -- 'standard' | 'wide' | 'narrow'
  seo_title text
  seo_description text
  og_image_id uuid → media.id
  published_at timestamptz
  scheduled_for timestamptz
  created_by uuid → users.id
  updated_by uuid → users.id
  created_at, updated_at, deleted_at

page_blocks
  id uuid pk
  page_id uuid → pages.id (cascade)
  ordinal int                       -- gap-buffered (10, 20, 30…) so reorder is cheap
  block_type text                   -- registry key: 'hero' | 'prose' | …
  props jsonb                       -- block-specific config (variant, alignment)
  content jsonb                     -- block-specific content (headline, body, mediaIds)
  visible boolean default true
  created_at, updated_at

page_revisions
  id uuid pk
  page_id uuid → pages.id (cascade)
  snapshot_jsonb                    -- { page, blocks[] } at the moment of publish/save
  edited_by uuid → users.id
  edited_at timestamptz
```

API surface (new `routes/cms/pages.ts`):

- `GET /cms/pages` — paginated list with status filter.
- `POST /cms/pages` — create (slug must be unique; new draft).
- `GET /cms/pages/:id` — page + ordered blocks.
- `PATCH /cms/pages/:id` — page-level fields.
- `POST /cms/pages/:id/blocks` — append (server picks next ordinal).
- `PATCH /cms/pages/:id/blocks/:blockId` — update one block.
- `POST /cms/pages/:id/blocks/reorder` — accepts `[blockId…]` and
  rewrites ordinals in a single transaction.
- `DELETE /cms/pages/:id/blocks/:blockId`.
- `POST /cms/pages/:id/publish` — flips status, snapshots a revision.
- `POST /cms/pages/:id/revert/:revisionId` — restores a snapshot.

Public renderer:

- New `pages/dynamic-page.tsx` component, registered with Wouter at
  `/:slug` **after** all explicit routes (so static routes always
  win). Fetches the page by slug, 404s if missing or non-published
  (unless `?preview=<token>` for editors).
- Renders `<Block kind={b.block_type} props={b.props}
  content={b.content} />`. The `Block` switcher resolves to a
  per-kind renderer from the registry.

Migration story for `content_parent_pages`: read-shim — when a
list-page renderer fetches its hero/intro, prefer a corresponding
`pages` row when one exists, fall back to `content_parent_pages`,
fall back to the hardcoded defaults. Migrate one slug at a time;
deprecate the old table once empty.

### Phase 1 — block library v1

A small, opinionated catalog. Each block lives at
`artifacts/synozur/src/blocks/<kind>/` with three files:

- `<kind>.schema.ts` — Zod schemas for `props` and `content`.
  Re-exported through `lib/api-zod` so the server validates writes
  with the same shape.
- `<kind>.renderer.tsx` — public-site React component. Pure render
  function over `(props, content)`. No data fetching beyond
  `mediaUrl()` lookups.
- `<kind>.editor.tsx` — admin form for the right-rail inspector.
  Built on `react-hook-form` + Zod (existing pattern).

A central `blocks/registry.ts` maps `block_type` →
`{ schema, Renderer, Editor, label, icon, defaultContent }`.

Initial block set:

| `block_type`    | What it is                                                  |
|-----------------|-------------------------------------------------------------|
| `hero`          | Eyebrow + headline + subhead + optional media + CTA buttons |
| `prose`         | TipTap-rendered rich text (reuses `RichTextEditor`)         |
| `two-column`    | Left/right slots; each slot is media-or-prose               |
| `image`         | Single image with caption + alt                             |
| `video-embed`   | Iframe video (YouTube / Vimeo) via existing iframe ext.     |
| `cta-card`      | Headline + body + button(s) on a card surface               |
| `faq`           | Selects from existing `faq_items` by tag or list            |
| `logo-strip`    | Selects from existing client / partner logos                |
| `testimonial`   | Quote + attribution + optional headshot                     |
| `spacer`        | Vertical rhythm control (xs/sm/md/lg/xl)                    |

Acceptance bar for shipping a block: renderer passes Axe in Playwright,
keyboard-navigable, supports both `cosmic` and `aurora` themes,
respects `prefers-reduced-motion`, no layout shift on image load.

### Phase 2 — admin page builder

New routes:

- `/admin/pages` — list (filter by status, slug search, last edited).
- `/admin/pages/new` — create page form (slug, title, layout).
- `/admin/pages/:id` — three-pane builder.

Three-pane layout:

```
┌─────────┬──────────────────────────┬──────────────┐
│ palette │ canvas (sortable list)   │ inspector    │
│         │                          │              │
│ hero    │ ┌──────────────────────┐ │ Hero block   │
│ prose   │ │ Hero: "Transform…"   │ │ ──────────── │
│ two-col │ └──────────────────────┘ │ Eyebrow [_]  │
│ image   │ ┌──────────────────────┐ │ Headline [_] │
│ …       │ │ Prose: "Synozur is…" │ │ Subhead  [_] │
│         │ └──────────────────────┘ │ Media   pick │
│         │ ┌──────────────────────┐ │ CTA1    [_]  │
│         │ │ + add block          │ │              │
│         │ └──────────────────────┘ │              │
└─────────┴──────────────────────────┴──────────────┘
```

Behaviors:

- Drag-and-drop reorder via `@dnd-kit/sortable`.
- Each block card: click selects (highlights, populates inspector);
  hover shows duplicate / delete / move handles.
- Inspector renders the selected block's `Editor` from the registry.
- Page-level inspector (when no block is selected): slug, title,
  status, scheduled-for, SEO, OG image.
- Auto-save draft (debounced 1.5s) — patches the in-progress block /
  page record, doesn't snapshot revisions until "Publish".
- Top bar: status pill, "View live", "Preview", "Publish",
  revision-history dropdown.
- Optimistic concurrency: every PATCH carries the page's
  `updated_at`; the server 409s if another editor moved ahead, and
  the UI offers a diff + reload.

### Phase 3 — in-place editing on the live site

The on-canvas builder is the primary authoring surface; in-place
editing is the **content-level** surface that lets editors hop
straight from the live page to the field they want to change.

Activation:

- A signed-in user with `site.manage` who appends `?edit=1` (or
  toggles edit mode in the admin app-switcher) gets an `EditOverlayProvider`
  mounted around the page.
- Public visitors never see anything different — the edit overlay
  bundle is admin-only (lazy-loaded, separate chunk).

Per block:

- Hover ring, "Edit", "Move ↑", "Move ↓", "Duplicate", "Delete".
- Click "Edit" → opens a side-drawer hosting the same `Editor`
  component the page builder uses, against the same API. Save updates
  the live page in place via React Query invalidation.

Per field (the differentiator vs. just opening the builder):

- The Hero block's `headline` and `subhead` render with
  `contenteditable` in edit mode; blur saves a patch.
- Image / video fields show a "Replace media" affordance that opens
  `MediaPickerModal` directly.
- Prose blocks open a TipTap editor inline (same component as today's
  posts admin), not in a side drawer.

Drafts vs. published:

- Edit-mode changes write a "working copy" that public visitors do
  not see until Publish.
- Working copy = a `pages` row in `draft` status that mirrors the
  published page's id chain — implemented by adding a
  `working_copy_of` self-FK on `pages` and serving the published row
  to anonymous traffic and the working copy to editors.
- Publish promotes the working copy onto the live row in a single
  transaction and snapshots a revision.

### Phase 4 — hardening

- **Performance.** Server-render dynamic pages via the existing
  Express layer (or a small SSR worker fronting the SPA), so first
  paint isn't blocked on a fetch round-trip. At minimum, inline the
  serialized page+blocks JSON into the HTML envelope so the SPA
  hydrates without a second request.
- **OG images.** Reuse the existing OG generator; key the cache by
  `(page_id, updated_at)`.
- **Sitemap.** `routes/seo.ts` learns a `pages` source — published
  pages appear in `sitemap.xml` with `lastmod = updated_at`.
- **Lighthouse CI.** Add at least one representative dynamic page
  (e.g. a converted `/about`) to `lighthouserc.json` with the same
  LCP / CLS / TBT budgets the hand-coded routes get.
- **Accessibility audit.** Playwright + Axe runs against each block
  in isolation (a fixture page that renders one of each at full
  width) plus one full composed page.
- **Audit log.** Every page mutation writes to `audit_log` with
  before / after JSON.
- **Permissions.** Two new capabilities — `pages.author` (edit
  drafts) and `pages.publish` (promote to public). Both implied by
  `site.manage` for backwards compatibility.
- **Publish-blocks integration.** The `scanPublishBlocks()` job
  learns to flag pages with missing alt text, missing SEO title, or
  blocks that fail validation, and surfaces them on
  `/admin/site-config/health`.

### Phase 5 — templates + opt-in migration

- **Page templates.** "Service detail", "Case study", "Landing
  page", "Webinar", "Generic content". Each template is a
  pre-composed block list seeded into a new page on creation. Lives
  in `artifacts/synozur/src/blocks/templates/*.ts`.
- **Migrate `content_parent_pages`.** One slug at a time; remove the
  table when last slug is migrated.
- **Migrate hand-coded marketing pages opt-in.** `/about`,
  `/partners`, `/clients`, the static `/privacy` and `/terms`
  pages are good candidates. `/contact`, `/start`, `/careers-apply`
  stay hand-coded — they are forms / interactive flows, not
  composed content.
- **Service / case-study / application detail pages.** These read
  from typed tables (`services`, `case_studies`, `applications`).
  They keep their typed schemas — the new model targets *page-level*
  composition, not item detail. A future enhancement could let an
  item-detail template host page-blocks below the fixed item header,
  but that's out of scope for v1.

## Cross-cutting concerns

**Multilingual.** This plan adds `pages` and `page_blocks` *without*
a `locale` column on day one. When the multilingual initiative
(BACKLOG item 2) lands, the migration is to add `locale` to both
tables and treat each (slug, locale) as a separate row. The block
content shape is already JSON, which makes per-locale variants
straightforward to ship later.

**A/B testing.** The existing `experiments` framework can target
either whole-page variants (two `pages` rows behind one slug, picked
by cohort) or block-level variants (a block whose `props.experimentId`
makes the renderer pick from a small variant array). Hold this for
phase 4 once the basic flow is in editorial use.

**Forms inside pages.** Forms remain hand-coded React components and
are exposed as a `form-embed` block (`block_type = 'form'`,
`content.formKey = 'contact' | 'subscribe' | 'whitepaper'`). The
renderer mounts the existing form component. Editors pick a form
from a dropdown, they don't author form schemas.

## Sequencing + rough sizing

| Phase | Description                                     | Engineer-weeks |
|-------|-------------------------------------------------|----------------|
| 0     | Data model, API, dynamic-page renderer          | 1.5            |
| 1     | Block library v1 (10 blocks, schemas, axe)      | 3              |
| 2     | Admin page builder UI                           | 3              |
| 3     | In-place edit overlay + working-copy publish    | 2              |
| 4     | Hardening (SSR, sitemap, LH CI, audit, caps)    | 1.5            |
| 5     | Templates + opt-in migration of static pages    | 1              |

Roughly **12 engineer-weeks** for one engineer end to end; halve with
two engineers working in parallel after phase 0 lands.

## Open questions

1. **Server-side rendering — how much do we need?** If we pre-render
   the page JSON into the HTML envelope, that probably covers LCP.
   Full SSR is a much larger commitment and would touch the whole
   SPA. Decide before phase 4.
2. **Wouter dynamic-route catch-all.** Wouter handles `/:slug` fine,
   but the order vs. all the existing explicit routes
   (`/about`, `/contact`, …) needs care so static routes always win.
   A single late-mounted `<Route path="/:slug">` after every explicit
   route works for one path segment; nested slugs (`/x/y`) require a
   thought — most likely we restrict v1 to single-segment slugs and
   reserve the rest for typed item detail.
3. **Block extensibility.** Are blocks an internal-only catalog, or
   do we want to support partner / client custom blocks? Recommend
   internal-only for v1; revisit if the request actually shows up.
4. **Cache invalidation on publish.** OG image cache, sitemap cache,
   any HTTP cache fronting the API — they all need to bust on
   publish. Wire this into the publish endpoint, not the client.
5. **What does "preview" look like for stakeholders without a
   login?** Signed preview tokens (short-lived JWT in a query param)
   are the usual answer; confirm before phase 2.
