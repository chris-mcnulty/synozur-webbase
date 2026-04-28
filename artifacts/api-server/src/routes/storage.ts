import { Router, type IRouter, type Request, type Response } from "express";
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

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

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
      // Migrated row → read via SPE. The ref shape carries speFileId, so
      // `downloadObject` dispatches to the SPE backend internally.
      response = await objectStorageService.downloadObject(
        objectStorageService.speRef(overlay.storageKey, overlay.speFileId),
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
