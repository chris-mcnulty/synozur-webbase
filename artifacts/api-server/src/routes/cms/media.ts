import { Router, type IRouter } from "express";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { ObjectStorageService } from "../../lib/objectStorage";
import { audit } from "../../lib/audit";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

router.get("/cms/media", requireAuth, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(mediaTable)
      .orderBy(desc(mediaTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(mediaTable),
  ]);
  res.json({ items, page, pageSize, total: totalRow[0]?.c ?? 0 });
});

const RegisterBody = z.object({
  storageKey: z.string().min(1),
  publicUrl: z.string().min(1),
  mime: z.string().nullish(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  byteSize: z.number().int().nullish(),
  altText: z.string().nullish(),
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
    const [row] = await db
      .insert(mediaTable)
      .values({
        storageKey: parsed.data.storageKey,
        publicUrl: parsed.data.publicUrl,
        mime: parsed.data.mime ?? null,
        width: parsed.data.width ?? null,
        height: parsed.data.height ?? null,
        byteSize: parsed.data.byteSize ?? null,
        altText: parsed.data.altText ?? null,
        uploadedBy: req.authedUser!.id,
      })
      .returning();
    res.status(201).json(row);
  },
);

const UpdateBody = z.object({
  altText: z.string().nullish(),
  mime: z.string().nullish(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
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
    const updates: Partial<typeof mediaTable.$inferInsert> = {};
    if (parsed.data.altText !== undefined) updates.altText = parsed.data.altText ?? null;
    if (parsed.data.mime !== undefined) updates.mime = parsed.data.mime ?? null;
    if (parsed.data.width !== undefined) updates.width = parsed.data.width ?? null;
    if (parsed.data.height !== undefined) updates.height = parsed.data.height ?? null;
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
    // Hard delete from storage too (best effort).
    try {
      if (row.storageKey.startsWith("/objects/")) {
        const file = await objectStorageService.getObjectEntityFile(row.storageKey);
        await file.delete({ ignoreNotFound: true });
      }
    } catch (err) {
      req.log.warn({ err, mediaId: row.id }, "Failed to delete object from storage");
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
