---
name: Stored content-type is the served content-type
description: Why fixing media.mime alone doesn't fix broken downloads/previews — the GCS object's own metadata is authoritative.
---

# Served content-type comes from the object, not the DB row

For GCS-backed media, the content-type a browser/CDN sees is read from the GCS
object's own metadata (`file.getMetadata().contentType` in
`gcsBackend.downloadObject`), NOT from `media.mime`. So a row with a correct
`media.mime` can still serve broken downloads if the stored object landed with
`application/octet-stream`.

**Why:** historical uploads stored objects with a generic/empty content-type.
Task #361 added a runtime byte-sniff for the resize path only; every non-resize
path (direct download, inline preview, CDN) still trusts the stored metadata.

**How to apply:**
- To repair, patch the GCS object metadata via `file.setMetadata({ contentType })`
  (exposed as `GcsAssetStorageBackend.setObjectContentType`), then optionally
  sync `media.mime`. The backfill script `backfillImageContentTypes.ts` does this
  for raster images; run `backfill:image-content-types` once against prod.
- Ambiguity is defined by `isAmbiguousContentType` (octet-stream / binary /
  empty). Format sniffing is `sniffRasterImageMime` (returns `image/*` or null),
  both in `routes/storage.ts`.
- SPE-backed rows (`spe_file_id` set) derive content-type from the file at
  download and have no metadata-patch path — they're out of scope for GCS repair.
- Non-raster ambiguous objects (PDFs stored as octet-stream) are still broken;
  the image backfill deliberately skips them.
