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

## Prod octet-stream uploads: now byte-sniffed in storage.ts (was a known gap)
Some objects on production report `application/octet-stream` even though the
bytes are a real raster image. Historically `streamObjectToResponse` only
resized when the stored content-type started with `image/` (`isThumbnailable`),
so `?w=1200&fmt=jpeg` was silently ignored and the raw full-size original
shipped as the OG share card. The SAME objects came back `image/*` (and resized)
through the LOCAL dev server, which is why the health test fetches local.

**Fixed:** when a resize is requested and the content-type is *ambiguous*
(`isAmbiguousContentType`: octet-stream / empty / binary), `streamObjectToResponse`
now peeks the first 16 bytes and resizes iff `bufferLooksLikeRasterImage`
(JPEG/PNG/GIF/WebP/BMP/TIFF magic). Trusted `image/*` still streams directly (no
peek); videos/PDFs/unknown binaries pass through raw. So the resize path is
robust to bad prod metadata now — dev→prod asset re-sync is no longer required
just to fix share-image sizing. Unit-tested via `test:storage-sniff`.
`streamObjectToResponse` is now `async` (peek awaits) — both storage route call
sites `await` it.

## Size invariant
Healthy dynamic images are always **1200px wide**; height varies because the
resize preserves aspect (1200×800, 1200×675…). Assert `width === 1200` +
landscape (`height ≤ width`), NOT a fixed 1200×630 — 630 only holds for the
hand-authored static defaults and the generated `/api/og/image` card.
