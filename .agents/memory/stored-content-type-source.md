---
name: Stored content-type is the served content-type (GCS only)
description: Why fixing media.mime alone doesn't fix broken downloads/previews for legacy GCS-backed rows — GCS object metadata is authoritative. SPE rows are unaffected.
---

# Served content-type: GCS vs SPE

## GCS-backed rows (no speFileId)
Content-type is read from the GCS object's own metadata (`file.getMetadata().contentType`
in `gcsBackend.downloadObject`), NOT from `media.mime`. A row with a correct `media.mime`
can still serve broken downloads if the stored object landed with `application/octet-stream`.

**Why:** historical uploads stored objects with a generic/empty content-type.
A runtime byte-sniff was added for the resize path (`?w=`) only; the no-`?w=` direct
streaming path also sniffs now (added as defence-in-depth) and overrides the header.

**How to repair permanently:** run `backfill:image-content-types` against prod — it calls
`GcsAssetStorageBackend.setObjectContentType` to patch the stored metadata.

## SPE-backed rows (speFileId set)
Content-type comes from the Graph API response headers — whatever SharePoint returns when
the file was uploaded. SPE honours the `contentType` parameter passed to `storeFile`, so
new uploads carry the correct MIME type automatically. No metadata-patch path is needed
or possible.

## publicUrl / route dispatch
- `/api/storage/objects/*` — dispatches by `speFileId` presence: SPE or GCS per row. ✓
- `/api/storage/public-objects/*` — always routes to GCS via `searchPublicObject`.
  SPE files are invisible here (GCS has no record of them → 404). Never use this route
  for upload_image or any SPE-written URL.

**Why it matters:** MCP `upload_image` previously used `/public-objects/` for its `publicUrl`,
causing 404 for all SPE-uploaded images. Fixed to use `/api/storage/objects/` (relative path).
