import express, { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { stashSpeUpload } from "../lib/storage/spe/uploadCache";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Hard ceiling on bytes the server will accept in a single direct-upload PUT.
// 100 MB is enough for the largest assets the marketing site has uploaded
// historically (videos / PDFs). Larger ceilings risk dragging the api-server
// process around when many uploads run concurrently.
const DIRECT_UPLOAD_LIMIT = "100mb";

// Upper bound to prevent sharp from being used as a resize-bomb amplifier.
const MAX_THUMBNAIL_WIDTH = 2048;

// Allowlist of video MIME types we accept for uploads. Mirrored on the
// client in `artifacts/synozur/src/lib/asset-kind.ts` so the picker only
// surfaces formats this endpoint will accept. The browser <video> element
// reliably autoplays MP4 (H.264) and WebM; MOV is included because iPhone
// captures land here and most are H.264-in-MOV which the browser plays
// without re-encoding. AV1-in-MKV and other exotic combinations are
// rejected because they will not autoplay in mainstream browsers and
// produce unusable hero videos.
const ALLOWED_VIDEO_MIME_TYPES: readonly string[] = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

function isVideoMime(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("video/");
}

function isAllowedVideoMime(contentType: string): boolean {
  return ALLOWED_VIDEO_MIME_TYPES.includes(contentType.toLowerCase());
}

/**
 * Lightweight magic-byte sniff for the video container formats we accept.
 * Returns true if the buffer's first bytes are consistent with `contentType`.
 *
 * - MP4 / MOV (ISO BMFF): bytes 4..7 spell "ftyp". This is true for both
 *   `video/mp4` and `video/quicktime`; the brand at bytes 8..11 distinguishes
 *   them, but for the purposes of "is this actually a playable container"
 *   the `ftyp` box header is sufficient.
 * - WebM (Matroska/EBML): file starts with the EBML magic `1A 45 DF A3`.
 *
 * Returns true when we don't have enough bytes to decide, so callers can
 * skip enforcement on tiny payloads rather than reject legitimate uploads.
 */
function videoBytesMatchContentType(buf: Buffer, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct === "video/mp4" || ct === "video/quicktime") {
    if (buf.length < 12) return true;
    return buf.slice(4, 8).toString("ascii") === "ftyp";
  }
  if (ct === "video/webm") {
    if (buf.length < 4) return true;
    return (
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3
    );
  }
  return true;
}

function parseWidth(req: Request): number | null {
  const raw = req.query.w;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== "string") return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_THUMBNAIL_WIDTH) return null;
  return n;
}

// Output format for the on-the-fly resize path. Defaults to WebP (smallest,
// used by the responsive-image helpers on the public site). `?fmt=jpeg`
// forces a JPEG instead — needed for Open Graph share images because
// LinkedIn reliably renders JPG/PNG but often silently drops WebP previews.
type ThumbnailFormat = "jpeg" | "webp";

function parseFormat(req: Request): ThumbnailFormat {
  const raw = req.query.fmt;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s === "string") {
    const v = s.toLowerCase();
    if (v === "jpeg" || v === "jpg") return "jpeg";
  }
  return "webp";
}

function isThumbnailable(contentType: string): boolean {
  if (!contentType.startsWith("image/")) return false;
  // SVG flows through sharp fine but re-rasterising it defeats the purpose.
  if (contentType.includes("svg")) return false;
  return true;
}

// Some objects on production report a generic/missing content-type even
// though the bytes are a perfectly good raster image (historical uploads
// stored without a proper image/* metadata header). When a resize is
// explicitly requested we can't trust `isThumbnailable` alone for these —
// otherwise the `?w=1200&fmt=jpeg` OG variant silently ships the raw,
// full-size original as the share card. Treat these as "unknown, sniff the
// bytes" rather than "definitely not an image".
export function isAmbiguousContentType(contentType: string): boolean {
  const c = contentType.toLowerCase().split(";")[0].trim();
  return (
    c === "" ||
    c === "application/octet-stream" ||
    c === "binary/octet-stream" ||
    c === "application/binary"
  );
}

// Number of leading bytes we buffer to detect a raster image from its magic
// number. 16 covers every signature we check below.
const IMAGE_SNIFF_BYTES = 16;

/**
 * Magic-byte sniff for the raster image formats sharp can resize. Returns the
 * canonical `image/*` MIME type when the buffer's leading bytes match a known
 * signature, or null otherwise. Used both for the ambiguous-content-type
 * resize path and for the one-time content-type backfill script that repairs
 * mislabeled stored objects.
 */
export function sniffRasterImageMime(buf: Buffer): string | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: "GIF87a" / "GIF89a" → starts with "GIF8"
  if (
    buf.length >= 4 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return "image/gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  // BMP: "BM"
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return "image/bmp";
  }
  // TIFF: little-endian "II*\0" (49 49 2A 00) or big-endian "MM\0*" (4D 4D 00 2A)
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a))
  ) {
    return "image/tiff";
  }
  return null;
}

/**
 * Magic-byte sniff for the raster image formats sharp can resize. Used only
 * for objects whose stored content-type is ambiguous (octet-stream / empty);
 * trusted `image/*` objects skip this entirely.
 */
export function bufferLooksLikeRasterImage(buf: Buffer): boolean {
  return sniffRasterImageMime(buf) !== null;
}

/**
 * Read up to `n` bytes from a web ReadableStream reader without discarding
 * them. Returns the buffered header; the reader is left positioned after the
 * consumed chunks so the remainder can be replayed via `readableFromReader`.
 */
async function peekBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < n) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    total += chunk.length;
  }
  return Buffer.concat(chunks);
}

/**
 * Reconstruct a Node Readable from an already-buffered header plus the
 * remaining, un-consumed bytes of a web stream reader.
 */
function readableFromReader(
  header: Buffer,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Readable {
  async function* gen(): AsyncGenerator<Buffer> {
    if (header.length > 0) yield header;
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      yield Buffer.from(value);
    }
  }
  return Readable.from(gen());
}

async function streamObjectToResponse(
  source: globalThis.Response,
  res: Response,
  width: number | null,
  format: ThumbnailFormat = "webp",
): Promise<void> {
  const contentType = source.headers.get("content-type") ?? "application/octet-stream";

  if (!source.body) {
    res.status(source.status);
    source.headers.forEach((value, key) => res.setHeader(key, value));
    res.end();
    return;
  }

  // Decide whether to resize and materialise the Node stream we'll pipe from.
  // Trusted image/* objects stream directly. Ambiguous objects (octet-stream /
  // empty content-type) are byte-sniffed so mislabeled raster images still get
  // resized instead of shipping the full-size original as an OG share card.
  let canThumb = false;
  let nodeStream: Readable;
  if (width != null && isThumbnailable(contentType)) {
    canThumb = true;
    nodeStream = Readable.fromWeb(source.body as ReadableStream<Uint8Array>);
  } else if (width != null && isAmbiguousContentType(contentType)) {
    const reader = (source.body as ReadableStream<Uint8Array>).getReader();
    const header = await peekBytes(reader, IMAGE_SNIFF_BYTES);
    canThumb = bufferLooksLikeRasterImage(header);
    nodeStream = readableFromReader(header, reader);
  } else {
    nodeStream = Readable.fromWeb(source.body as ReadableStream<Uint8Array>);
  }

  let transform: ReturnType<typeof sharp> | null = null;
  let finished = false;

  const handleStreamError = (err: unknown) => {
    if (finished) return;
    finished = true;
    console.error("Failed to stream object response", err);
    nodeStream.destroy(err instanceof Error ? err : undefined);
    transform?.destroy(err instanceof Error ? err : undefined);

    if (!res.headersSent && !res.writableEnded) {
      res.status(502).end();
      return;
    }

    if (!res.writableEnded) {
      res.destroy(err instanceof Error ? err : undefined);
    }
  };

  const handleResponseClose = () => {
    if (finished) return;
    finished = true;
    nodeStream.destroy();
    transform?.destroy();
  };

  nodeStream.on("error", handleStreamError);
  res.on("close", handleResponseClose);

  if (canThumb) {
    // Derive cacheability from the upstream object's headers so that private
    // objects are not accidentally cached by shared proxies/CDNs.
    const upstreamCacheControl = source.headers.get("cache-control") ?? "";
    const isPublic =
      upstreamCacheControl.includes("public") &&
      !upstreamCacheControl.includes("private");
    const thumbnailCacheControl = isPublic
      ? "public, max-age=31536000, immutable"
      : "private, max-age=3600";
    res.status(source.status);
    res.setHeader("Content-Type", format === "jpeg" ? "image/jpeg" : "image/webp");
    res.setHeader("Cache-Control", thumbnailCacheControl);
    const resized = sharp()
      .rotate()
      .resize({ width: width!, withoutEnlargement: true });
    transform =
      format === "jpeg"
        ? resized.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true })
        : resized.webp({ quality: 80 });
    transform.on("error", handleStreamError);
    nodeStream.pipe(transform).pipe(res);
    return;
  }

  res.status(source.status);
  source.headers.forEach((value, key) => res.setHeader(key, value));
  nodeStream.pipe(res);
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    // Reject any video/* upload whose declared MIME isn't on our allowlist.
    // The browser <video> element only reliably autoplays a narrow set of
    // container/codec combinations; accepting `video/x-matroska`,
    // `video/x-msvideo`, etc. just produces hero videos that silently fail
    // to play in production.
    if (isVideoMime(contentType) && !isAllowedVideoMime(contentType)) {
      res.status(415).json({
        error: `Unsupported video format "${contentType}". Allowed: ${ALLOWED_VIDEO_MIME_TYPES.join(", ")}.`,
      });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();

    // Map to the canonical `/objects/uploads/<token>` storage_key shape
    // regardless of which backend is active, so callers persisting
    // `objectPath` write the same form for GCS and SPE.
    const objectPath = canonicaliseUploadObjectPath(uploadURL);

    // Return the raw URL — GCS backends already return an absolute HTTPS
    // signed URL; the SPE backend returns a server-relative path
    // (`/api/storage/uploads/spe-direct/<token>`). Server-side
    // absolutization using req.get("host") was unreliable in Replit's
    // production proxy because the Host header may carry the internal
    // container address rather than the public-facing domain. Clients
    // must absolutize relative URLs using window.location.origin, which
    // is always the correct public origin.
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * PUT /storage/uploads/spe-direct/:token
 *
 * #127 Phase 3-C — server-proxied upload for the SharePoint Embedded
 * backend. SPE has no presigned-URL equivalent, so the SPE backend's
 * `getObjectEntityUploadURL()` returns a relative URL that points here
 * instead of back at SharePoint. The client PUTs the file body in
 * exactly the same shape it would have used for a GCS presigned URL;
 * this route buffers the raw request body in memory via `express.raw()`
 * (up to `DIRECT_UPLOAD_LIMIT`), then uploads those buffered bytes to
 * SPE and stashes the resulting drive-item id in an in-memory cache
 * keyed by `:token` so the subsequent `POST /cms/media` can populate
 * `spe_file_id` on the new media row.
 *
 * Auth: gated to authenticated CMS roles. The bytes are written using
 * the api-server's SPE credentials, so unauthenticated callers must not
 * be able to populate the container (would let anyone create orphans
 * and burn storage). Same role set the `POST /cms/media` step requires
 * so the two-step flow has consistent gating.
 *
 * Body: raw bytes of the file. Content-Type header carries the mime.
 * Optional `?name=<original-filename>` for SharePoint metadata stamping.
 */
router.put(
  "/storage/uploads/spe-direct/:token",
  requireAuth,
  requireRole("admin", "editor", "author", "contributor"),
  express.raw({ limit: DIRECT_UPLOAD_LIMIT, type: "*/*" }),
  async (req: Request, res: Response) => {
    const token = String(req.params.token ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      res.status(400).json({ error: "Invalid token" });
      return;
    }
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    const contentType = req.get("content-type") ?? "application/octet-stream";

    // Same allowlist enforcement as the request-url endpoint, repeated
    // here because the SPE-direct route is the actual byte sink — without
    // this a client could request a presigned URL with `video/mp4` and
    // then PUT bytes with a different content-type header.
    if (isVideoMime(contentType) && !isAllowedVideoMime(contentType)) {
      res.status(415).json({
        error: `Unsupported video format "${contentType}". Allowed: ${ALLOWED_VIDEO_MIME_TYPES.join(", ")}.`,
      });
      return;
    }

    // Post-upload byte-level check: the request body has already been
    // buffered (express.raw above), so we can sniff the container header
    // before forwarding it to SharePoint. Catches the "MIME is video/mp4
    // but the bytes are an MKV / a renamed .exe / random JSON" case that
    // the MIME check alone cannot.
    if (isVideoMime(contentType) && !videoBytesMatchContentType(body, contentType)) {
      res.status(415).json({
        error: `Uploaded bytes do not match declared video format "${contentType}".`,
      });
      return;
    }

    const queryName = req.query.name;
    const filename =
      typeof queryName === "string" && queryName.length > 0 ? queryName : token;

    try {
      const ref = await objectStorageService.uploadObject({
        body,
        contentType,
        filename,
        documentType: "media",
        ownerId: token,
      });
      // Defensive: the pre-check above guarantees active=spe, but if
      // some future change broke that invariant we'd still rather
      // surface clearly than stash a half-formed cache entry.
      if (!ref.speFileId) {
        res.status(500).json({
          error: "uploadObject succeeded but returned no speFileId — active backend / abstraction mismatch",
        });
        return;
      }
      stashSpeUpload(token, {
        speFileId: ref.speFileId,
        speContainerId: ref.speContainerId,
        contentType,
        size: body.length,
        originalName: typeof queryName === "string" ? queryName : undefined,
      });
      res.status(200).json({
        ok: true,
        token,
        speFileId: ref.speFileId,
        speContainerId: ref.speContainerId ?? null,
        size: body.length,
      });
    } catch (err) {
      req.log.error({ err, token }, "SPE direct upload failed");
      res.status(502).json({ error: (err as Error).message });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * Accepts optional `?w=<width>` to return a WebP thumbnail resized server-side.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);
    await streamObjectToResponse(response, res, parseWidth(req), parseFormat(req));
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities. Accepts optional `?w=<width>` to return a WebP
 * thumbnail resized server-side.
 *
 * #127 Phase 3 — read-path overlay. The `media.spe_file_id` column is
 * the migration's authoritative bit: if set, the row's bytes have been
 * mirrored to SharePoint Embedded and we read from there; otherwise
 * (legacy + un-migrated rows) we keep reading from GCS via the
 * `storage_key` column. The GCS bytes are never deleted by the
 * migration, so clearing `spe_file_id` rolls a row back to GCS without
 * touching either backend's data.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const storageKey = `/objects/${wildcardPath}`;

    // Single indexed lookup. Cheap. The route used to skip this entirely
    // and resolve straight against GCS; the cost (one Postgres point read)
    // buys us SPE/GCS dispatch and crash-safe rollback.
    const overlay = await db.query.mediaTable.findFirst({
      where: eq(mediaTable.storageKey, storageKey),
      columns: { storageKey: true, speFileId: true, speContainerId: true },
    });

    let response: globalThis.Response;
    if (overlay?.speFileId) {
      // Migrated row → read via SPE. The ref shape carries speFileId so
      // `downloadObject` dispatches to the SPE backend internally; pass
      // `speContainerId` through so the read targets the container that
      // physically holds the item (rather than whichever the active env
      // is currently configured for).
      response = await objectStorageService.downloadObject(
        objectStorageService.speRef(
          overlay.storageKey,
          overlay.speFileId,
          overlay.speContainerId ?? undefined,
        ),
      );
    } else {
      // Un-migrated (or non-media — e.g. legacy `assets` rows reach this
      // route too and never get the overlay). Resolve the GCS object
      // directly. This is the original pre-Phase-3 behavior.
      const objectFile = await objectStorageService.getObjectEntityFile(storageKey);
      response = await objectStorageService.downloadObject(objectFile);
    }

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   ref,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    await streamObjectToResponse(response, res, parseWidth(req), parseFormat(req));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

const SPE_DIRECT_PREFIX = "/api/storage/uploads/spe-direct/";

function canonicaliseUploadObjectPath(uploadURL: string): string {
  if (uploadURL.startsWith(SPE_DIRECT_PREFIX)) {
    const token = uploadURL.slice(SPE_DIRECT_PREFIX.length);
    return `/objects/uploads/${token}`;
  }
  // GCS URLs (https://storage.googleapis.com/...) and any future shapes
  // route through the existing GCS normalizer unchanged.
  return objectStorageService.normalizeObjectEntityPath(uploadURL);
}

export default router;
