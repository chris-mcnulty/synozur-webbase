import { Router, type IRouter } from "express";
import { eq, ilike, desc } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import {
  ListAssetsResponseItem,
  ListAssetsResponse,
  CreateAssetBody,
  ListAssetsQueryParams,
  DeleteAssetParams,
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
  const rows = search
    ? await db
        .select()
        .from(assetsTable)
        .where(ilike(assetsTable.originalName, `%${search}%`))
        .orderBy(desc(assetsTable.uploadedAt))
    : await db.select().from(assetsTable).orderBy(desc(assetsTable.uploadedAt));
  res.json(ListAssetsResponse.parse(rows));
});

router.post("/assets", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { originalName, mimeType, size, storageKey } = parsed.data;
  const filename = originalName;
  const [row] = await db
    .insert(assetsTable)
    .values({
      filename,
      originalName,
      mimeType,
      size,
      storageKey,
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
