import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import {
  db,
  assetsTable,
  mediaTable,
  assetCategoriesTable,
} from "@workspace/db";
import { requireAuth } from "../../middlewares/auth";

const router: IRouter = Router();

const PAGE_SIZE_MAX = 100;

const ListQuery = z.object({
  search: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid().optional(),
  source: z.enum(["asset", "media", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(48),
});

/**
 * Unified list view that merges the legacy `assets` table and the `media`
 * table into a single response for the admin Asset Library page.
 *
 * Each row carries a `source` discriminator so the UI can route delete/update
 * operations back to the correct underlying endpoint.
 */
router.get("/cms/library/assets", requireAuth, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { search, categoryId, source, page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;

  const assetConditions: SQL[] = [];
  if (search) {
    const like = `%${search}%`;
    const assetSearch = or(
      ilike(assetsTable.originalName, like),
      ilike(assetsTable.filename, like),
      ilike(assetsTable.altText, like),
    );
    if (assetSearch) assetConditions.push(assetSearch);
  }
  if (categoryId) assetConditions.push(eq(assetsTable.categoryId, categoryId));

  const mediaConditions: SQL[] = [];
  if (search) {
    const like = `%${search}%`;
    const mediaSearch = or(
      ilike(mediaTable.altText, like),
      ilike(mediaTable.originalName, like),
      ilike(mediaTable.storageKey, like),
    );
    if (mediaSearch) mediaConditions.push(mediaSearch);
  }
  if (categoryId) mediaConditions.push(eq(mediaTable.categoryId, categoryId));

  const assetWhere =
    assetConditions.length === 0
      ? undefined
      : assetConditions.length === 1
        ? assetConditions[0]
        : and(...assetConditions);
  const mediaWhere =
    mediaConditions.length === 0
      ? undefined
      : mediaConditions.length === 1
        ? mediaConditions[0]
        : and(...mediaConditions);

  const wantAssets = source === "all" || source === "asset";
  const wantMedia = source === "all" || source === "media";

  const [assetRows, mediaRows, assetTotal, mediaTotal, categories] = await Promise.all([
    wantAssets
      ? assetWhere
        ? db
            .select()
            .from(assetsTable)
            .where(assetWhere)
            .orderBy(desc(assetsTable.uploadedAt))
            .limit(pageSize)
            .offset(offset)
        : db
            .select()
            .from(assetsTable)
            .orderBy(desc(assetsTable.uploadedAt))
            .limit(pageSize)
            .offset(offset)
      : Promise.resolve([]),
    wantMedia
      ? mediaWhere
        ? db
            .select()
            .from(mediaTable)
            .where(mediaWhere)
            .orderBy(desc(mediaTable.createdAt))
            .limit(pageSize)
            .offset(offset)
        : db
            .select()
            .from(mediaTable)
            .orderBy(desc(mediaTable.createdAt))
            .limit(pageSize)
            .offset(offset)
      : Promise.resolve([]),
    wantAssets
      ? (assetWhere
          ? db.select({ n: count() }).from(assetsTable).where(assetWhere)
          : db.select({ n: count() }).from(assetsTable)
        ).then((r) => r[0]?.n ?? 0)
      : Promise.resolve(0),
    wantMedia
      ? (mediaWhere
          ? db.select({ n: count() }).from(mediaTable).where(mediaWhere)
          : db.select({ n: count() }).from(mediaTable)
        ).then((r) => r[0]?.n ?? 0)
      : Promise.resolve(0),
    db.select().from(assetCategoriesTable),
  ]);

  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  type UnifiedItem = {
    source: "asset" | "media";
    id: string;
    storageKey: string;
    publicUrl: string | null;
    mime: string | null;
    byteSize: number | null;
    width: number | null;
    height: number | null;
    altText: string | null;
    originalName: string | null;
    categoryId: string | null;
    categorySlug: string | null;
    categoryLabel: string | null;
    uploadedAt: string;
  };

  const items: UnifiedItem[] = [];

  for (const r of assetRows) {
    const cat =
      (r.categoryId && categoryById.get(r.categoryId)) ||
      (r.category && categoryBySlug.get(r.category)) ||
      null;
    items.push({
      source: "asset",
      id: String(r.id),
      storageKey: r.storageKey,
      publicUrl: null,
      mime: r.mimeType,
      byteSize: r.size,
      width: null,
      height: null,
      altText: r.altText,
      originalName: r.originalName,
      categoryId: cat?.id ?? null,
      categorySlug: cat?.slug ?? r.category ?? null,
      categoryLabel: cat?.label ?? null,
      uploadedAt: r.uploadedAt.toISOString(),
    });
  }

  for (const r of mediaRows) {
    const cat = r.categoryId ? categoryById.get(r.categoryId) : null;
    items.push({
      source: "media",
      id: r.id,
      storageKey: r.storageKey,
      publicUrl: r.publicUrl,
      mime: r.mime,
      byteSize: r.byteSize,
      width: r.width,
      height: r.height,
      altText: r.altText,
      originalName: r.originalName,
      categoryId: cat?.id ?? null,
      categorySlug: cat?.slug ?? null,
      categoryLabel: cat?.label ?? null,
      uploadedAt: r.createdAt.toISOString(),
    });
  }

  items.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  const total = Number(assetTotal) + Number(mediaTotal);
  res.json({ items, total, page, pageSize });
});

export default router;
