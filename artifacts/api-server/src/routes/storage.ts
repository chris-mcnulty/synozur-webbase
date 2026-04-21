import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import sharp from "sharp";
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
    // Content is addressed by a content-stable UUID path, so the transformed
    // variant is safe to cache aggressively by width.
    res.status(source.status);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
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
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * Accepts optional `?w=<width>` to return a WebP thumbnail resized server-side.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);
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
