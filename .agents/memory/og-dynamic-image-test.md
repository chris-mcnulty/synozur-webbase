---
name: OG dynamic-image health test
description: Why the dynamic OG image test (posts/events) fetches the LOCAL build, not production, and the prod octet-stream quirk it papers over.
---

# OG dynamic-image health test (posts + events)

`test:og-dynamic` (`ogDynamicImages.test.ts`) samples published posts + upcoming
events, resolves `og:image` via `/api/og?path=...`, and asserts the image is a
reachable, correctly-sized card. It's wired into the CI gate alongside
`test:og-static-pages` / `test:og-images`.

## Fetch the LOCAL build, not the resolved production URL
Resolved `og:image` URLs are absolute and point at the production origin
(`siteOrigin()` → e.g. `https://www.synozur.com/...`). The test re-points any
same-origin `/api/*` image URL at the in-process test server before fetching, so
it validates the current code + dev DB (the pre-publish source of truth), not
whatever is deployed. Same-origin **static** files (e.g. `/opengraph.jpg`) are
NOT served by the api-server — validate those on disk in
`artifacts/synozur/public/`. External URLs: fetch directly, lenient dims.

**Why:** A per-change CI gate must test the code under review. Fetching prod is
flaky and, worse, currently RED for reasons unrelated to any given change — see
below.

## Prod serves octet-stream for some uploads; dev resizes correctly
The storage resize path (`streamObjectToResponse` in `routes/storage.ts`) only
resizes when the *source object's stored content-type* starts with `image/`
(`isThumbnailable`). Some objects on production report
`application/octet-stream`, so `?w=1200&fmt=jpeg` is silently ignored → the raw,
full-size PNG (e.g. 1280×720, 3 MB, `application/octet-stream`) ships as the
share card. The SAME objects fetched through the LOCAL dev server come back as
proper `image/*` and DO resize to 1200-wide JPEG — so this is a
production-storage-metadata problem, not a code bug in the resize path. Don't
"fix" storage.ts to chase it; the dev→prod DB/asset re-sync is the intended
remedy. If you ever point OG health checks at prod, expect these to fail until
prod assets are re-synced.

## Size invariant
Healthy dynamic images are always **1200px wide**; height varies because the
resize preserves aspect (1200×800, 1200×675…). Assert `width === 1200` +
landscape (`height ≤ width`), NOT a fixed 1200×630 — 630 only holds for the
hand-authored static defaults and the generated `/api/og/image` card.
