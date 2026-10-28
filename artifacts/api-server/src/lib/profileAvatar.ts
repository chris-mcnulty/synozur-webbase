import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { db, mediaTable } from "@workspace/db";
import { speFileStorage } from "./storage/spe/fileStorage";
import { logger } from "./logger";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export class AvatarImageError extends Error {}

export async function normalizeAvatar(body: Buffer): Promise<Buffer> {
  if (!body.length) throw new AvatarImageError("Choose a JPEG, PNG or WebP image.");
  if (body.length > AVATAR_MAX_BYTES) throw new AvatarImageError("Photo must be 5 MB or smaller.");
  try {
    const image = sharp(body, { limitInputPixels: 16_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
      throw new AvatarImageError("Choose a non-animated JPEG, PNG or WebP image.");
    }
    // Re-encode to strip EXIF/GPS metadata and never serve arbitrary uploaded bytes.
    return await image.rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
  } catch (err) {
    if (err instanceof AvatarImageError) throw err;
    throw new AvatarImageError("This image could not be read. Choose a valid JPEG, PNG or WebP photo.");
  }
}

export async function storeProfileAvatar(body: Buffer, userId: string): Promise<string> {
  const normalized = await normalizeAvatar(body);
  const id = randomUUID();
  const storageKey = `/objects/uploads/${id}`;
  const avatarUrl = `/api/storage${storageKey}`;
  // Call SPE directly: no backend selection, GCS, or provider fallback.
  const stored = await speFileStorage.storeFile({
    body: normalized,
    filename: `avatar-${id}.webp`,
    contentType: "image/webp",
    documentType: "media",
    ownerId: id,
    uploadedByUserId: userId,
  });
  try {
    const metadata = await sharp(normalized).metadata();
    await db.insert(mediaTable).values({
      id, storageKey, publicUrl: avatarUrl,
      mime: "image/webp",
      byteSize: normalized.length,
      width: metadata.width,
      height: metadata.height,
      altText: "Profile photo",
      originalName: `avatar-${id}.webp`,
      uploadedBy: userId,
      speFileId: stored.itemId,
      speContainerId: stored.containerId,
    });
  } catch (err) {
    await speFileStorage.deleteFile(stored.itemId, stored.containerId).catch((cleanupError) => {
      logger.warn({ err: cleanupError, itemId: stored.itemId }, "Failed to clean up unregistered avatar");
    });
    throw err;
  }
  return avatarUrl;
}
