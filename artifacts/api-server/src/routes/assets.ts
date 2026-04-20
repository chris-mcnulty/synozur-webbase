import { Router, type IRouter } from "express";
import { eq, and, ilike, desc, type SQL } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import {
  ListAssetsResponseItem,
  ListAssetsResponse,
  CreateAssetBody,
  ListAssetsQueryParams,
  DeleteAssetParams,
  ASSET_CATEGORIES,
  isAssetCategory,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/assets", requireAdmin, async (req, res): Promise<void> => {
  const params = ListAssetsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const search = params.data.search?.trim();
  const category = params.data.category?.trim();
  const conditions: SQL[] = [];
  if (search) conditions.push(ilike(assetsTable.originalName, `%${search}%`));
  if (category) conditions.push(eq(assetsTable.category, category));
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
  const { originalName, mimeType, size, storageKey, category } = parsed.data;
  if (category != null && !isAssetCategory(category)) {
    res.status(400).json({
      error: `Unknown category "${category}". Allowed: ${ASSET_CATEGORIES.join(", ")}`,
    });
    return;
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
      category: category ?? null,
      uploadedBy: req.admin?.email ?? null,
    })
    .returning();
  res.status(201).json(ListAssetsResponseItem.parse(row));
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
