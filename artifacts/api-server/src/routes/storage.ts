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
import { ObjectPermission } from "../lib/objectAcl";
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

function parseWidth(req: Request): number | null {
  const raw = req.query.w;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== "string") return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_THUMBNAIL_WIDTH) return null;
  return n;
}

function isThumbnailable(contentType: string): boolean {
  if (!contentType.startsWith("image/")) return false;
  // SVG flows through sharp fine but re-rasterising it defeats the purpose.
  if (contentType.includes("svg")) return false;
  return true;
}

function streamObjectToResponse(
  source: globalThis.Response,
  res: Response,
  width: number | null,
): void {
  const contentType = source.headers.get("content-type") ?? "application/octet-stream";
  const canThumb = width != null && isThumbnailable(contentType);

  if (!source.body) {
    res.status(source.status);
    source.headers.forEach((value, key) => res.setHeader(key, value));
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(source.body as ReadableStream<Uint8Array>);
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
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", thumbnailCacheControl);
    transform = sharp()
      .rotate()
      .resize({ width: width!, withoutEnlargement: true })
      .webp({ quality: 80 });
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

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

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
 * we stream the bytes through to SPE and stash the resulting drive-item
 * id in an in-memory cache keyed by `:token` so the subsequent
 * `POST /cms/media` can populate `spe_file_id` on the new media row.
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
    // C6 fix — pre-check the active backend before reading the body
    // and uploading it. Without this, when STORAGE_BACKEND=gcs the
    // route would happily upload to GCS via the active backend and
    // then 409 because the resulting ref has no speFileId, leaving a
    // GCS orphan. Bail early instead.
    const activeBackend = (process.env["STORAGE_BACKEND"] ?? "gcs").trim().toLowerCase();
    if (activeBackend !== "spe") {
      res.status(409).json({
        error:
          "spe-direct route requires STORAGE_BACKEND=spe; refusing to write bytes through this path under the active backend",
      });
      return;
    }
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    const contentType = req.get("content-type") ?? "application/octet-stream";
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
    streamObjectToResponse(response, res, parseWidth(req));
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

    streamObjectToResponse(response, res, parseWidth(req));
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

export default router;
