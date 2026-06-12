---
name: Edit-wedge image snapshot fields
description: Why the public insight/detail payload can't populate image IDs in the in-place edit wedge, and how the wedge must display existing images.
---

The public detail payloads (e.g. the Insight GET schema in `lib/api-spec/openapi.yaml`) expose image **URLs** (`heroImageUrl`, `ogImageUrl`) but **not** image **IDs** — the IDs (`heroImageId`, `ogImageId`) live only on the CMS/admin schemas.

**Why it matters:** the in-place edit wedge (`edit-wedge.tsx` / `edit-wedge-body.tsx`) mounts on public detail pages and receives that public payload as its snapshot. So it cannot rely on `snapshot.heroImageId`/`ogImageId` to know whether an image exists — those are usually `null` there. Display/labels must key off the **URL** (`heroImageUrl ?? heroImage`), while the PATCH still only sends `heroImageId`/`ogImageId` (and only when changed, so untouched images are never wiped).

**How to apply:** when adding image display to any wedge/public-page-driven editor, render thumbnails from the URL via `resolveMediaUrl` (from `@/lib/insights`), and only treat the image as "set" using URL-or-ID presence — not ID alone.
