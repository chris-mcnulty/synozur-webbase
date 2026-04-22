import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  db,
  faqCategoriesTable,
  faqItemsTable,
  type FaqCategory,
  type FaqItem,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth, requireRole("admin", "editor")];

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeCategory(c: FaqCategory) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    displayOrder: c.displayOrder,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function serializeItem(i: FaqItem) {
  return {
    id: i.id,
    categoryId: i.categoryId,
    slug: i.slug,
    question: i.question,
    answerHtml: i.answerHtml,
    displayOrder: i.displayOrder,
    status: i.status,
    publishedAt: i.publishedAt,
    seoTitle: i.seoTitle,
    seoDescription: i.seoDescription,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

async function ensureUniqueCategorySlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    const rows = await db
      .select({ id: faqCategoriesTable.id })
      .from(faqCategoriesTable)
      .where(
        excludeId
          ? and(eq(faqCategoriesTable.slug, slug), ne(faqCategoriesTable.id, excludeId))
          : eq(faqCategoriesTable.slug, slug),
      )
      .limit(1);
    if (rows.length === 0) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

async function ensureUniqueItemSlug(
  categoryId: string,
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    const rows = await db
      .select({ id: faqItemsTable.id })
      .from(faqItemsTable)
      .where(
        excludeId
          ? and(
              eq(faqItemsTable.categoryId, categoryId),
              eq(faqItemsTable.slug, slug),
              ne(faqItemsTable.id, excludeId),
            )
          : and(eq(faqItemsTable.categoryId, categoryId), eq(faqItemsTable.slug, slug)),
      )
      .limit(1);
    if (rows.length === 0) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

// ---------------------------------------------------------------------------
// Public endpoint — returns all published categories with nested published
// items in one round trip. Ordering: category.displayOrder → item.displayOrder.
// ---------------------------------------------------------------------------

router.get("/faq", async (_req, res) => {
  const [categories, items] = await Promise.all([
    db
      .select()
      .from(faqCategoriesTable)
      .where(eq(faqCategoriesTable.status, "published"))
      .orderBy(
        asc(faqCategoriesTable.displayOrder),
        asc(faqCategoriesTable.createdAt),
      ),
    db
      .select()
      .from(faqItemsTable)
      .where(eq(faqItemsTable.status, "published"))
      .orderBy(asc(faqItemsTable.displayOrder), asc(faqItemsTable.createdAt)),
  ]);
  const byCategory = new Map<string, FaqItem[]>();
  for (const it of items) {
    const list = byCategory.get(it.categoryId) ?? [];
    list.push(it);
    byCategory.set(it.categoryId, list);
  }
  res.json({
    categories: categories.map((c) => ({
      ...serializeCategory(c),
      items: (byCategory.get(c.id) ?? []).map(serializeItem),
    })),
  });
});

// ---------------------------------------------------------------------------
// Admin — categories CRUD
// ---------------------------------------------------------------------------

const CategoryBody = z.object({
  slug: z.string().nullish(),
  name: z.string().min(1),
  description: z.string().nullish(),
  displayOrder: z.number().int().optional(),
  status: z.enum(["draft", "published"]).optional(),
});
const CategoryPatch = CategoryBody.partial();

router.get("/cms/faq/categories", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(faqCategoriesTable)
    .orderBy(asc(faqCategoriesTable.displayOrder), asc(faqCategoriesTable.createdAt));
  res.json({ items: rows.map(serializeCategory) });
});

router.post("/cms/faq/categories", ...adminGuard, async (req, res) => {
  const parsed = CategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueCategorySlug(d.slug || d.name);
  const [row] = await db
    .insert(faqCategoriesTable)
    .values({
      slug,
      name: d.name,
      description: d.description ?? null,
      displayOrder: d.displayOrder ?? 0,
      status: d.status ?? "published",
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_category.create",
    entity: "faq_category",
    entityId: row.id,
  });
  res.status(201).json(serializeCategory(row));
});

router.patch("/cms/faq/categories/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.faqCategoriesTable.findFirst({
    where: eq(faqCategoriesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = CategoryPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueCategorySlug(d.slug, id);
  }
  for (const k of ["name", "description", "displayOrder", "status"] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(faqCategoriesTable)
    .set(updates)
    .where(eq(faqCategoriesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_category.update",
    entity: "faq_category",
    entityId: id,
  });
  res.json(serializeCategory(updated));
});

router.delete("/cms/faq/categories/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  // Items are removed via ON DELETE CASCADE on the FK.
  await db.delete(faqCategoriesTable).where(eq(faqCategoriesTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_category.delete",
    entity: "faq_category",
    entityId: id,
  });
  res.status(204).end();
});

const CategoryReorder = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

router.post("/cms/faq/categories/reorder", ...adminGuard, async (req, res) => {
  const parsed = CategoryReorder.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { ids } = parsed.data;
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(faqCategoriesTable)
      .set({ displayOrder: (i + 1) * 10, updatedAt: new Date() })
      .where(eq(faqCategoriesTable.id, ids[i]!));
  }
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_category.reorder",
    entity: "faq_category",
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Admin — items CRUD
// ---------------------------------------------------------------------------

const ItemBody = z.object({
  categoryId: z.string().uuid(),
  slug: z.string().nullish(),
  question: z.string().min(1),
  answerHtml: z.string().optional(),
  displayOrder: z.number().int().optional(),
  status: z.enum(["draft", "published"]).optional(),
  publishedAt: z.string().datetime().nullish(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
});
const ItemPatch = ItemBody.partial();

router.get("/cms/faq/items", ...readGuard, async (req, res) => {
  const categoryId =
    typeof req.query.categoryId === "string" ? req.query.categoryId : null;
  const base = db.select().from(faqItemsTable);
  const rows = await (categoryId ? base.where(eq(faqItemsTable.categoryId, categoryId)) : base)
    .orderBy(asc(faqItemsTable.displayOrder), asc(faqItemsTable.createdAt));
  res.json({ items: rows.map(serializeItem) });
});

router.post("/cms/faq/items", ...adminGuard, async (req, res) => {
  const parsed = ItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueItemSlug(d.categoryId, d.slug || d.question);
  const [row] = await db
    .insert(faqItemsTable)
    .values({
      categoryId: d.categoryId,
      slug,
      question: d.question,
      answerHtml: d.answerHtml ?? "",
      displayOrder: d.displayOrder ?? 0,
      status: d.status ?? "published",
      publishedAt: d.publishedAt ? new Date(d.publishedAt) : null,
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_item.create",
    entity: "faq_item",
    entityId: row.id,
  });
  res.status(201).json(serializeItem(row));
});

router.patch("/cms/faq/items/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.faqItemsTable.findFirst({
    where: eq(faqItemsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = ItemPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const nextCategoryId = d.categoryId ?? existing.categoryId;
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueItemSlug(nextCategoryId, d.slug, id);
  }
  if (d.categoryId !== undefined) updates.categoryId = d.categoryId;
  for (const k of [
    "question",
    "answerHtml",
    "displayOrder",
    "status",
    "seoTitle",
    "seoDescription",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  if (d.publishedAt !== undefined) {
    updates.publishedAt = d.publishedAt ? new Date(d.publishedAt) : null;
  }
  const [updated] = await db
    .update(faqItemsTable)
    .set(updates)
    .where(eq(faqItemsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_item.update",
    entity: "faq_item",
    entityId: id,
  });
  res.json(serializeItem(updated));
});

router.delete("/cms/faq/items/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  await db.delete(faqItemsTable).where(eq(faqItemsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_item.delete",
    entity: "faq_item",
    entityId: id,
  });
  res.status(204).end();
});

const ItemReorder = z.object({
  categoryId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1),
});

router.post("/cms/faq/items/reorder", ...adminGuard, async (req, res) => {
  const parsed = ItemReorder.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { categoryId, ids } = parsed.data;

  // Validate that all provided IDs belong to the given category and are unique
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length) {
    res.status(400).json({ error: "Duplicate IDs in reorder list" });
    return;
  }
  const existing = await db
    .select({ id: faqItemsTable.id })
    .from(faqItemsTable)
    .where(eq(faqItemsTable.categoryId, categoryId));
  const existingIds = new Set(existing.map((r) => r.id));
  const unknownIds = ids.filter((id) => !existingIds.has(id));
  if (unknownIds.length > 0) {
    res.status(400).json({ error: "Unknown or out-of-category item IDs", ids: unknownIds });
    return;
  }

  for (let i = 0; i < ids.length; i++) {
    await db
      .update(faqItemsTable)
      .set({ displayOrder: (i + 1) * 10, updatedAt: new Date() })
      .where(and(eq(faqItemsTable.id, ids[i]!), eq(faqItemsTable.categoryId, categoryId)));
  }
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_item.reorder",
    entity: "faq_item",
  });
  res.status(204).end();
});

export default router;
