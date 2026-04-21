import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, categoriesTable, tagsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { toSlug } from "../../lib/slug";
import { audit } from "../../lib/audit";
import { listEntitiesForTagSlug } from "../../lib/taxonomy";

const router: IRouter = Router();

// Public: list entities carrying the given tag slug. Powers tag-landing
// pages. Grouped by entity type (post, video, white_paper, ...). See #99.
router.get("/taxonomy/tags/:slug/entities", async (req, res) => {
  const slug = toSlug(String(req.params.slug));
  const grouped = await listEntitiesForTagSlug(slug);
  const total = Object.values(grouped).reduce((n, ids) => n + ids.length, 0);
  res.json({ slug, total, entities: grouped });
});

const Upsert = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
});

// CATEGORIES
router.get("/cms/categories", async (_req, res) => {
  const rows = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  res.json(rows);
});

router.post(
  "/cms/categories",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const parsed = Upsert.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const [row] = await db
      .insert(categoriesTable)
      .values({
        slug: toSlug(parsed.data.slug),
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .returning();
    await audit({
      actorId: req.authedUser!.id,
      action: "category.create",
      entity: "category",
      entityId: row.id,
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/cms/categories/:id",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const parsed = Upsert.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const updates: Partial<typeof categoriesTable.$inferInsert> = {};
    if (parsed.data.slug) updates.slug = toSlug(parsed.data.slug);
    if (parsed.data.name) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
    const [row] = await db
      .update(categoriesTable)
      .set(updates)
      .where(eq(categoriesTable.id, String(req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  },
);

router.delete(
  "/cms/categories/:id",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    await db.delete(categoriesTable).where(eq(categoriesTable.id, String(req.params.id)));
    res.status(204).end();
  },
);

// TAGS
router.get("/cms/tags", async (_req, res) => {
  const rows = await db.select().from(tagsTable).orderBy(tagsTable.name);
  res.json(rows);
});

const TagBody = z.object({ slug: z.string().min(1), name: z.string().min(1) });

router.post(
  "/cms/tags",
  requireAuth,
  requireRole("admin", "editor", "author"),
  async (req, res) => {
    const parsed = TagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const [row] = await db
      .insert(tagsTable)
      .values({ slug: toSlug(parsed.data.slug), name: parsed.data.name })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/cms/tags/:id",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const parsed = TagBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const updates: Partial<typeof tagsTable.$inferInsert> = {};
    if (parsed.data.slug) updates.slug = toSlug(parsed.data.slug);
    if (parsed.data.name) updates.name = parsed.data.name;
    const [row] = await db
      .update(tagsTable)
      .set(updates)
      .where(eq(tagsTable.id, String(req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  },
);

router.delete(
  "/cms/tags/:id",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    await db.delete(tagsTable).where(eq(tagsTable.id, String(req.params.id)));
    res.status(204).end();
  },
);

export default router;
