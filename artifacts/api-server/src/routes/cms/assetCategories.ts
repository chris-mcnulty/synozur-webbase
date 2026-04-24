import { Router, type IRouter } from "express";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, assetCategoriesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";

const router: IRouter = Router();

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CreateBody = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(SLUG_RE, "Slug must be lowercase, hyphen-separated"),
  label: z.string().trim().min(1).max(120),
  sortOrder: z.coerce.number().int().optional(),
});

const UpdateBody = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(SLUG_RE, "Slug must be lowercase, hyphen-separated")
    .optional(),
  label: z.string().trim().min(1).max(120).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

router.get("/cms/asset-categories", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(assetCategoriesTable)
    .orderBy(asc(assetCategoriesTable.sortOrder), asc(assetCategoriesTable.label));
  res.json({ items: rows });
});

router.post(
  "/cms/asset-categories",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const existing = await db.query.assetCategoriesTable.findFirst({
      where: eq(assetCategoriesTable.slug, parsed.data.slug),
    });
    if (existing) {
      res.status(409).json({ error: "Slug already exists" });
      return;
    }
    const [row] = await db
      .insert(assetCategoriesTable)
      .values({
        slug: parsed.data.slug,
        label: parsed.data.label,
        sortOrder: parsed.data.sortOrder ?? 0,
      })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/cms/asset-categories/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const id = String(req.params.id);
    if (parsed.data.slug) {
      const clash = await db.query.assetCategoriesTable.findFirst({
        where: eq(assetCategoriesTable.slug, parsed.data.slug),
      });
      if (clash && clash.id !== id) {
        res.status(409).json({ error: "Slug already exists" });
        return;
      }
    }
    const [row] = await db
      .update(assetCategoriesTable)
      .set({
        ...(parsed.data.slug !== undefined ? { slug: parsed.data.slug } : {}),
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.sortOrder !== undefined
          ? { sortOrder: parsed.data.sortOrder }
          : {}),
      })
      .where(eq(assetCategoriesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  },
);

router.delete(
  "/cms/asset-categories/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    const [row] = await db
      .delete(assetCategoriesTable)
      .where(eq(assetCategoriesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;
