---
name: SEO audit OG-image findings
description: How the SEO audit distinguishes autofillable ogImage vs. the og_image_missing warning, and when a kind must suppress it.
---

# SEO audit OG-image findings

The SEO audit (`artifacts/api-server/src/lib/seoAudit.ts`) emits **two distinct**
OG-image signals from `buildFinding`:

- **`ogImage`** — the dedicated og_image column is blank but a hero/artwork image
  exists to promote into it. Autofillable (goes in `suggested.ogImage`, is in the
  admin `FILLABLE_KEYS`).
- **`og_image_missing`** — the page has NO editor-set share image at all, so social
  unfurls fall back to the dynamic `/api/og/image` card. **Pure warning, never
  autofillable** (not in `suggested`, not in `FILLABLE_KEYS`).

`hasEditorImage` is derived from `ogImage || fallbackImage`, plus an optional
explicit `hasEditorImage` arg for tables whose image lives behind an id (posts:
`ogImageId ?? heroImageId`) rather than a URL column.

**Convention — suppress unactionable findings:** a kind with NO image field of any
kind (services, solutions) must strip BOTH `ogImage*` and `og_image_missing`.
Otherwise every such page shows a permanent, unfixable finding = pure noise.

**Centralized policy (#360):** per-kind OG suppression is no longer inline in each
audit function — it lives in the exported `OG_FINDING_POLICY` (a total
`Record<ArtifactKind, {suppressOgImageAutofill, suppressOgImageMissing}>`) applied via
`filterOgFindings(kind, missing)`. Because the Record is total, adding a new
`ArtifactKind` without a policy entry is a compile error. Note the autofill key is
camelCase `ogImage` and the warning is snake_case `og_image_missing`, so
`startsWith("ogImage")` matches ONLY the autofill key. Regression-tested in
`seoAudit.ogFindings.test.ts` (`pnpm --filter @workspace/api-server run test:seo-og-findings`).
Posts still separately drop `seoTitle*` inline (not OG-related).

**Why:** marketing wants a heads-up only where they can act. The dynamic OG card is
valid+branded, so "missing" is advisory, not an error; surfacing it where there's
no field to fix would train users to ignore the whole audit.

**How to apply:** when adding a new audited kind, pass its real share-image column
as `fallbackImage` if it has one (then keep og_image_missing); if it has no image
field, strip og_image_missing in the filter. Adding a kind touches: the
`ArtifactKind` union + `totals` in seoAudit.ts, the `runAudit` Promise.all, the
`applyAutofill` `touched` record + switch case, the autofill enum in `routes/seo.ts`,
and the frontend `SeoArtifactKind` (`synozur/src/lib/api.ts`) + `seo-audit.tsx`
(KIND_LABEL, groupFindings, editorHref, formatMissingLabel).
