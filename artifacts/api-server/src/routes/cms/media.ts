import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, mediaTable, assetCategoriesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { ObjectStorageService } from "../../lib/objectStorage";
import { audit } from "../../lib/audit";
import { consumeSpeUpload } from "../../lib/storage/spe/uploadCache";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid().optional(),
});

router.get("/cms/media", requireAuth, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { page, pageSize, search, categoryId } = parsed.data;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (search) {
    const like = `%${search}%`;
    const searchExpr = or(
      ilike(mediaTable.altText, like),
      ilike(mediaTable.originalName, like),
      ilike(mediaTable.storageKey, like),
    );
    if (searchExpr) conditions.push(searchExpr);
  }
  if (categoryId) conditions.push(eq(mediaTable.categoryId, categoryId));
  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  const listQuery = where
    ? db.select().from(mediaTable).where(where)
    : db.select().from(mediaTable);
  const countQuery = where
    ? db.select({ c: sql<number>`count(*)::int` }).from(mediaTable).where(where)
    : db.select({ c: sql<number>`count(*)::int` }).from(mediaTable);

  const [items, totalRow] = await Promise.all([
    listQuery.orderBy(desc(mediaTable.createdAt)).limit(pageSize).offset(offset),
    countQuery,
  ]);
  res.json({ items, page, pageSize, total: totalRow[0]?.c ?? 0 });
});

// #142 Phase A — `altText` is required and non-empty. The `media` table
// enforces NOT NULL at the DB; the upload UI pre-fills from the file's
// `originalName` and surfaces a "needs review" badge for placeholder
// values so editors are prompted to write real copy.
const RegisterBody = z.object({
  storageKey: z.string().min(1),
  publicUrl: z.string().min(1),
  mime: z.string().nullish(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  byteSize: z.number().int().nullish(),
  altText: z.string().trim().min(1, "Alt text is required"),
  originalName: z.string().nullish(),
  categoryId: z.string().uuid().nullish(),
});

router.post(
  "/cms/media",
  requireAuth,
  requireRole("admin", "editor", "author", "contributor"),
  async (req, res) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    if (parsed.data.categoryId) {
      const cat = await db.query.assetCategoriesTable.findFirst({
        where: eq(assetCategoriesTable.id, parsed.data.categoryId),
      });
      if (!cat) {
        res.status(400).json({ error: "Unknown categoryId" });
        return;
      }
    }
    // #127 Phase 3-C — pick up the SPE direct-upload bookkeeping if this
    // row was uploaded via the spe-direct route. The token is the trailing
    // path segment of `storageKey` (e.g. `/objects/uploads/<token>`); the
    // upload cache stores the speFileId/speContainerId Microsoft assigned.
    // Falls through cleanly when the row was uploaded via the GCS path —
    // `consumeSpeUpload` returns null, columns stay NULL, the read path
    // resolves to GCS via storage_key.
    const lastSegment =
      parsed.data.storageKey.split("/").filter(Boolean).pop() ?? "";
    const speEntry = lastSegment ? consumeSpeUpload(lastSegment) : null;

    const [row] = await db
      .insert(mediaTable)
      .values({
        storageKey: parsed.data.storageKey,
        publicUrl: parsed.data.publicUrl,
        mime: parsed.data.mime ?? speEntry?.contentType ?? null,
        width: parsed.data.width ?? null,
        height: parsed.data.height ?? null,
        byteSize: parsed.data.byteSize ?? speEntry?.size ?? null,
        altText: parsed.data.altText,
        originalName: parsed.data.originalName ?? speEntry?.originalName ?? null,
        categoryId: parsed.data.categoryId ?? null,
        uploadedBy: req.authedUser!.id,
        speFileId: speEntry?.speFileId ?? null,
        speContainerId: speEntry?.speContainerId ?? null,
      })
      .returning();
    res.status(201).json(row);
  },
);

const UpdateBody = z.object({
  // When supplied, `altText` must be a non-empty string. Omit to leave the
  // existing value unchanged; null is rejected (alt text is NOT NULL).
  altText: z.string().trim().min(1).optional(),
  mime: z.string().nullish(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  originalName: z.string().nullish(),
  categoryId: z.string().uuid().nullish(),
});

router.patch(
  "/cms/media/:id",
  requireAuth,
  requireRole("admin", "editor", "author", "contributor"),
  async (req, res) => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    if (parsed.data.categoryId) {
      const cat = await db.query.assetCategoriesTable.findFirst({
        where: eq(assetCategoriesTable.id, parsed.data.categoryId),
      });
      if (!cat) {
        res.status(400).json({ error: "Unknown categoryId" });
        return;
      }
    }
    const updates: Partial<typeof mediaTable.$inferInsert> = {};
    if (parsed.data.altText !== undefined) updates.altText = parsed.data.altText;
    if (parsed.data.mime !== undefined) updates.mime = parsed.data.mime ?? null;
    if (parsed.data.width !== undefined) updates.width = parsed.data.width ?? null;
    if (parsed.data.height !== undefined) updates.height = parsed.data.height ?? null;
    if (parsed.data.originalName !== undefined)
      updates.originalName = parsed.data.originalName ?? null;
    if (parsed.data.categoryId !== undefined)
      updates.categoryId = parsed.data.categoryId ?? null;
    if (Object.keys(updates).length === 0) {
      const existing = await db.query.mediaTable.findFirst({
        where: eq(mediaTable.id, String(req.params.id)),
      });
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(existing);
      return;
    }
    const [row] = await db
      .update(mediaTable)
      .set(updates)
      .where(eq(mediaTable.id, String(req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await audit({
      actorId: req.authedUser!.id,
      action: "media.update",
      entity: "media",
      entityId: row.id,
    });
    res.json(row);
  },
);

router.delete(
  "/cms/media/:id",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const row = await db.query.mediaTable.findFirst({
      where: eq(mediaTable.id, String(req.params.id)),
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Hard delete from storage too (best effort). Distinct from the
    // GCS→SPE migration: this is an admin-initiated row delete, the
    // user explicitly wants the bytes gone. We delete from whichever
    // side(s) the row lives on. The migration script itself is strictly
    // additive and never touches GCS.
    if (row.speFileId) {
      try {
        await objectStorageService.deleteObject({
          storageKey: row.storageKey,
          speFileId: row.speFileId,
          // Target the container that originally stored the item;
          // protects against active-container rotation in site_settings.
          speContainerId: row.speContainerId ?? undefined,
        });
      } catch (err) {
        req.log.warn(
          { err, mediaId: row.id, speFileId: row.speFileId, speContainerId: row.speContainerId },
          "Failed to delete SPE object on media row delete",
        );
      }
    }
    if (row.storageKey.startsWith("/objects/")) {
      try {
        const ref = await objectStorageService.getObjectEntityFile(row.storageKey);
        await objectStorageService.deleteObject(ref);
      } catch (err) {
        req.log.warn(
          { err, mediaId: row.id, storageKey: row.storageKey },
          "Failed to delete GCS object on media row delete",
        );
      }
    }
    await db.delete(mediaTable).where(eq(mediaTable.id, row.id));
    await audit({
      actorId: req.authedUser!.id,
      action: "media.delete",
      entity: "media",
      entityId: row.id,
    });
    res.status(204).end();
  },
);

export default router;
