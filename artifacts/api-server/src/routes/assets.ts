import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and, ilike, desc, type SQL } from "drizzle-orm";
import { db, assetsTable, assetCategoriesTable } from "@workspace/db";
import {
  ListAssetsResponseItem,
  ListAssetsResponse,
  CreateAssetBody,
  ListAssetsQueryParams,
  DeleteAssetParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

const UpdateAssetBody = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  altText: z.string().nullable().optional(),
});

router.get("/assets", requireAdmin, async (req, res): Promise<void> => {
  const params = ListAssetsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const search = params.data.search?.trim();
  const category = params.data.category?.trim();
  const categoryId = params.data.categoryId;

  const conditions: SQL[] = [];
  if (search) conditions.push(ilike(assetsTable.originalName, `%${search}%`));
  if (categoryId) {
    conditions.push(eq(assetsTable.categoryId, categoryId));
  } else if (category) {
    // Legacy callers may still filter by the string category. If a category
    // row matches this slug, prefer the FK; otherwise fall back to the string.
    const cat = await db.query.assetCategoriesTable.findFirst({
      where: eq(assetCategoriesTable.slug, category),
    });
    if (cat) {
      conditions.push(eq(assetsTable.categoryId, cat.id));
    } else {
      conditions.push(eq(assetsTable.category, category));
    }
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);
  const rows = where
    ? await db.select().from(assetsTable).where(where).orderBy(desc(assetsTable.uploadedAt))
    : await db.select().from(assetsTable).orderBy(desc(assetsTable.uploadedAt));
  res.json(ListAssetsResponse.parse(rows));
});

router.post("/assets", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { originalName, mimeType, size, storageKey, category, categoryId, altText: altTextRaw } = parsed.data;
  const altText = altTextRaw ?? null;

  let resolvedCategoryId: string | null = null;
  let resolvedCategorySlug: string | null = null;

  if (categoryId) {
    const cat = await db.query.assetCategoriesTable.findFirst({
      where: eq(assetCategoriesTable.id, categoryId),
    });
    if (!cat) {
      res.status(400).json({ error: `Unknown categoryId "${categoryId}"` });
      return;
    }
    resolvedCategoryId = cat.id;
    resolvedCategorySlug = cat.slug;
  } else if (category != null) {
    const cat = await db.query.assetCategoriesTable.findFirst({
      where: eq(assetCategoriesTable.slug, category),
    });
    if (!cat) {
      res.status(400).json({ error: `Unknown category "${category}"` });
      return;
    }
    resolvedCategoryId = cat.id;
    resolvedCategorySlug = cat.slug;
  }

  const filename = originalName;
  const [row] = await db
    .insert(assetsTable)
    .values({
      filename,
      originalName,
      mimeType,
      size,
      storageKey,
      category: resolvedCategorySlug,
      categoryId: resolvedCategoryId,
      altText,
      uploadedBy: req.admin?.email ?? null,
    })
    .returning();
  res.status(201).json(ListAssetsResponseItem.parse(row));
});

router.patch("/assets/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Partial<typeof assetsTable.$inferInsert> = {};
  if (parsed.data.altText !== undefined) updates.altText = parsed.data.altText;
  if (parsed.data.categoryId !== undefined) {
    if (parsed.data.categoryId === null) {
      updates.categoryId = null;
      updates.category = null;
    } else {
      const cat = await db.query.assetCategoriesTable.findFirst({
        where: eq(assetCategoriesTable.id, parsed.data.categoryId),
      });
      if (!cat) {
        res.status(400).json({ error: "Unknown categoryId" });
        return;
      }
      updates.categoryId = cat.id;
      updates.category = cat.slug;
    }
  }
  if (Object.keys(updates).length === 0) {
    const existing = await db.query.assetsTable.findFirst({
      where: eq(assetsTable.id, id),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(ListAssetsResponseItem.parse(existing));
    return;
  }
  const [row] = await db
    .update(assetsTable)
    .set(updates)
    .where(eq(assetsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(ListAssetsResponseItem.parse(row));
});

router.delete("/assets/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(assetsTable)
    .where(eq(assetsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
