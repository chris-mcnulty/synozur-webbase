# Content Types

This codebase uses a **central library + per-type detail tables** pattern for
all browsable content (white papers, case studies, models, videos, podcasts,
posts, events). The same pattern is how new content types should be added.

## The pattern

```
┌─────────────────────────────────────────────────────────────┐
│  collateral  (the unified library — browsable / featurable) │
│  ─────────── slug, type, title, subtitle, description,       │
│  heroImage, pillar, tags, url, featured, featuredRank,       │
│  publishedAt, active, sourceId                               │
└─────────────────────────────────────────────────────────────┘
         ▲                  ▲                  ▲
         │ sourceId          │ sourceId         │ sourceId
         │                   │                  │
 ┌───────────────┐  ┌──────────────────┐  ┌──────────────┐
 │ white_papers  │  │ polaris_episodes │  │   offices    │
 │ bodyHtml,     │  │ audioUrl, guest, │  │ address,     │
 │ pageCount,    │  │ duration         │  │ hours,       │
 │ SEO fields…   │  │                  │  │ phone, geo…  │
 └───────────────┘  └──────────────────┘  └──────────────┘
```

- `collateral` is the **runtime authority** for what's in the library. Its
  slug is the URL slug and its row controls visibility (`active`),
  carousel placement (`featured`, `featuredRank`), and pillar/service
  filtering. Every browsable item exists here.
- A per-type **source-of-truth table** (e.g. `white_papers`, `offices`)
  holds editorial fields specific to that type (long-form body, SEO meta,
  address, hours, etc.).
- The two are linked by `collateral.sourceId = '<type>:<source-row-uuid>'`.
- Edits flow source → collateral via `upsertCollateralFrom<Type>()` in
  `artifacts/api-server/src/lib/syncCollateral.ts`. The collateral admin
  blocks direct edits to content fields on synced rows so source remains
  the only writer.

## Recipe: adding a new content type

Worked example: adding **`office`** as a new content type with
type-specific fields `address`, `hours`, `phone`, `lat`, `lng`.

### 1. Add an enum value

`lib/db/src/schema/collateral.ts`:

```ts
export const COLLATERAL_TYPES = [
  // …existing…
  "office",
] as const;
```

Then run the drizzle migration that adds the value to the
`collateral_type` Postgres enum.

### 2. Create the source-of-truth table

`lib/db/src/schema/offices.ts`:

```ts
export const officesTable = pgTable("offices", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),               // mirrors collateral.slug
  title: text("title").notNull(),             // office name
  address: text("address").notNull(),
  city: text("city").notNull(),
  // …region, postalCode, country…
  hours: jsonb("hours").$type<OfficeHours>(),
  phone: text("phone"),
  lat: numeric("lat"),
  lng: numeric("lng"),
  status: officeStatusEnum("status").notNull().default("draft"),
  // …common fields: heroImage, shortDescription, publishedAt, active,
  //    deletedAt, createdAt, updatedAt…
}, (t) => [
  uniqueIndex("offices_slug_key").on(t.slug),
  uniqueIndex("offices_source_id_key").on(t.id),
]);
```

Re-export from `lib/db/src/schema/index.ts` and from `lib/db/src/index.ts`.

### 3. Wire the canonical URL

`lib/api-zod/src/constants.ts` — add a branch to `canonicalUrlForCollateral`:

```ts
case "office":
  return `/offices/${slug}`;
```

And add `"office"` to `SYNCED_COLLATERAL_TYPES` so the generic collateral
admin blocks creating offices directly (they must be created via the
office editor so the source row exists).

### 4. Write the sync helper

`artifacts/api-server/src/lib/syncCollateral.ts`:

```ts
const OFFICE_SOURCE_PREFIX = "office:";
export function officeSourceId(officeId: string) {
  return `${OFFICE_SOURCE_PREFIX}${officeId}`;
}

export async function upsertCollateralFromOffice(office: Office) {
  const sourceId = officeSourceId(office.id);
  const isPublished =
    office.status === "published" && office.active && !office.deletedAt;
  const syncedFields = {
    type: "office" as const,
    title: office.title,
    subtitle: office.city,
    description: office.shortDescription ?? "",
    heroImage: office.heroImage ?? "",
    pillar: null,
    tags: office.tags ?? [],
    url: canonicalUrlForCollateral("office", office.slug),
    external: false,
    publishedAt: office.publishedAt,
    featured: false,
    featuredRank: null,
    serviceId: null,
    active: isPublished,
    updatedAt: new Date(),
  };
  // Upsert by sourceId (existing row → update; otherwise insert with
  // ensureUniqueCollateralSlug to handle slug collisions with other types).
  // …same pattern as upsertCollateralFromWhitePaper…
}

export async function softDeleteCollateralForOffice(officeId: string) {
  // …same pattern as the white-paper variant…
}
```

Call `upsertCollateralFromOffice` from your office admin routes after
create/update, and `softDeleteCollateralForOffice` from the delete route.

### 5. Add the public detail route

`artifacts/synozur/src/App.tsx`:

```tsx
<Route path="/offices" component={Offices} />
<Route path="/offices/:slug" component={OfficeDetail} />
```

`artifacts/synozur/src/pages/office-detail.tsx` — follow the
`white-paper-detail.tsx` pattern: look up by slug from `collateral` first
(authoritative), then hydrate office-specific fields from `offices` by
slug. The collateral lookup ensures every library item renders even if
the source table drifts.

### 6. Add the admin editor

Create `artifacts/synozur/src/pages/admin/library/office-edit.tsx` (or
under a new admin nav section). It writes to `/cms/offices` which on save
triggers `upsertCollateralFromOffice` server-side.

The generic library admin (`/library/collateral`) automatically:

- Blocks creating new `office` rows (via `SYNCED_COLLATERAL_TYPES`)
- Routes "Edit" on synced office rows to the office editor (via
  `editorPathForSource` in `collateral-list.tsx` — add an `"office"`
  branch there returning your editor's URL)
- Locks content fields on the collateral edit page when `sourceId` is set,
  while leaving `featured`, `featuredRank`, `active`, `serviceId`, and
  `solutionId` editable (those are library-curation properties, not
  source content)

## Anti-patterns to avoid

- **Don't write `/items/<slug>` URLs.** That route exists only as a
  permanent redirect for legacy backlinks. The canonical URL writer
  (`canonicalUrlForCollateral`) and the admin POST handler will not let
  this regress, but seed scripts have historically slipped past — always
  use the helper.
- **Don't create rows with a synced type directly in the collateral admin.**
  The API rejects this with a `400 Use the dedicated <type> editor`. If
  you find yourself wanting to, you actually need a source-of-truth row.
- **Don't make the source-table slug the URL slug authority.** Collateral
  is the runtime authority. The source-table slug should track collateral's
  slug; sync helpers maintain this invariant.
- **Don't add a content type without a per-type detail table** (unless its
  fields are fully covered by `collateral`). If you do, content lives only
  in `collateral` and you lose the dedicated editor / SEO meta / etc.
  Webinar and training are the two grandfathered exceptions and remain
  freely editable in the generic library admin.

## Reference files

| Concern | File |
|---|---|
| Collateral schema and types | `lib/db/src/schema/collateral.ts` |
| Canonical URL helper | `lib/api-zod/src/constants.ts` |
| Sync helpers | `artifacts/api-server/src/lib/syncCollateral.ts` |
| Admin collateral API (POST/PATCH guards) | `artifacts/api-server/src/routes/collateral.ts` |
| Admin collateral UI (synced banner, locks) | `artifacts/synozur/src/pages/admin/library/collateral-edit.tsx` |
| Admin collateral list (synced badge, edit-at-source) | `artifacts/synozur/src/pages/admin/library/collateral-list.tsx` |
| Public route table | `artifacts/synozur/src/App.tsx` |
| White-paper detail (pattern for collateral-first lookup) | `artifacts/synozur/src/pages/white-paper-detail.tsx` |
