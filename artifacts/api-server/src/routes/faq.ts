import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  db,
  faqCategoriesTable,
  faqItemsTable,
  ARTIFACT_STATUSES,
  type FaqCategory,
  type FaqItem,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import { siteOrigin } from "../lib/siteOrigin";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth, requireRole("admin", "editor")];

// ---------------------------------------------------------------------------
// Visibility filter — #108: matches `isArtifactPubliclyVisible` from
// `_artifactBase.ts` but expressed in SQL so it can run inside a `where`
// clause. Identical to the pattern used by applications/case-studies/etc.
// ---------------------------------------------------------------------------
function visibleClauses<T extends typeof faqCategoriesTable | typeof faqItemsTable>(
  t: T,
) {
  return [
    eq(t.active, true),
    eq(t.status, "published" as const),
    sql`${t.deletedAt} is null`,
    sql`(${t.publishedAt} is null or ${t.publishedAt} <= now())`,
    sql`(${t.unpublishedAt} is null or ${t.unpublishedAt} > now())`,
  ];
}

// ---------------------------------------------------------------------------
// Serialization — keeps the public/admin JSON shape stable across the #108
// schema migration. New lifecycle fields are exposed only on admin endpoints.
// ---------------------------------------------------------------------------

function serializePublicCategory(c: FaqCategory) {
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

function serializePublicItem(i: FaqItem) {
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

function serializeAdminCategory(c: FaqCategory) {
  return {
    ...serializePublicCategory(c),
    title: c.title,
    publishedAt: c.publishedAt,
    unpublishedAt: c.unpublishedAt,
    featured: c.featured,
    featuredRank: c.featuredRank,
    active: c.active,
    sourceId: c.sourceId,
    deletedAt: c.deletedAt,
  };
}

function serializeAdminItem(i: FaqItem) {
  return {
    ...serializePublicItem(i),
    title: i.title,
    unpublishedAt: i.unpublishedAt,
    featured: i.featured,
    featuredRank: i.featuredRank,
    active: i.active,
    sourceId: i.sourceId,
    deletedAt: i.deletedAt,
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

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Public endpoint — returns all visible categories with nested visible items
// in one round trip. Ordering: category.displayOrder → item.displayOrder.
// ---------------------------------------------------------------------------

async function loadPublishedFaq() {
  const [categories, items] = await Promise.all([
    db
      .select()
      .from(faqCategoriesTable)
      .where(and(...visibleClauses(faqCategoriesTable)))
      .orderBy(
        asc(faqCategoriesTable.displayOrder),
        asc(faqCategoriesTable.createdAt),
      ),
    db
      .select()
      .from(faqItemsTable)
      .where(and(...visibleClauses(faqItemsTable)))
      .orderBy(asc(faqItemsTable.displayOrder), asc(faqItemsTable.createdAt)),
  ]);
  const byCategory = new Map<string, FaqItem[]>();
  for (const it of items) {
    const list = byCategory.get(it.categoryId) ?? [];
    list.push(it);
    byCategory.set(it.categoryId, list);
  }
  return categories.map((c) => ({
    category: c,
    items: byCategory.get(c.id) ?? [],
  }));
}

router.get("/faq", async (_req, res) => {
  const grouped = await loadPublishedFaq();
  // Public read; safe to cache at the edge for a few minutes. Editors who
  // republish will see staleness no worse than `max-age` while CDNs revalidate
  // in the background per `stale-while-revalidate`.
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  res.json({
    categories: grouped.map(({ category, items }) => ({
      ...serializePublicCategory(category),
      items: items.map(serializePublicItem),
    })),
  });
});

// FAQPage JSON-LD as a standalone document. Crawlers and LLM agents can fetch
// this directly (e.g. linked from /llms.txt) instead of executing the SPA.
// Same shape as the inline `<script type="application/ld+json">` injected by
// the FAQ page in the React app.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

router.get("/faq/jsonld.json", async (_req, res) => {
  const grouped = await loadPublishedFaq();
  const origin = siteOrigin();
  const mainEntity = grouped.flatMap(({ category, items }) =>
    items.map((it) => ({
      "@type": "Question",
      name: it.question,
      // Per-question canonical URL — same shape as the sitemap entry so
      // search engines and AIO crawlers resolve each Q&A to a distinct page.
      "@id": `${origin}/faq/${category.slug}/${it.slug}`,
      acceptedAnswer: {
        "@type": "Answer",
        text: stripHtml(it.answerHtml) || it.question,
      },
    })),
  );
  res.setHeader("Content-Type", "application/ld+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  res.json({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
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
  status: z.enum(ARTIFACT_STATUSES).optional(),
  publishedAt: z.string().nullish(),
  unpublishedAt: z.string().nullish(),
  featured: z.boolean().optional(),
  featuredRank: z.number().int().nullish(),
  active: z.boolean().optional(),
});
const CategoryPatch = CategoryBody.partial();

router.get("/cms/faq/categories", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(faqCategoriesTable)
    .where(sql`${faqCategoriesTable.deletedAt} is null`)
    .orderBy(asc(faqCategoriesTable.displayOrder), asc(faqCategoriesTable.createdAt));
  res.json({ items: rows.map(serializeAdminCategory) });
});

router.post("/cms/faq/categories", ...adminGuard, async (req, res) => {
  const parsed = CategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueCategorySlug(d.slug || d.name);
  const status = d.status ?? "published";
  const [row] = await db
    .insert(faqCategoriesTable)
    .values({
      slug,
      // `title` mirrors the domain-facing display field (`name`) so generic
      // artifact tooling has something useful to read.
      title: d.name,
      name: d.name,
      description: d.description ?? null,
      displayOrder: d.displayOrder ?? 0,
      status,
      // Default published_at to "now" when created in a published state so
      // the visibility filter immediately exposes the row.
      publishedAt:
        parseDate(d.publishedAt) ?? (status === "published" ? new Date() : null),
      unpublishedAt: parseDate(d.unpublishedAt),
      featured: d.featured ?? false,
      featuredRank: d.featuredRank ?? null,
      active: d.active ?? true,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "faq_category.create",
    entity: "faq_category",
    entityId: row.id,
  });
  res.status(201).json(serializeAdminCategory(row));
});

router.patch("/cms/faq/categories/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.faqCategoriesTable.findFirst({
    where: eq(faqCategoriesTable.id, id),
  });
  if (!existing || existing.deletedAt) {
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
  if (d.name !== undefined) {
    updates.name = d.name;
    updates.title = d.name;
  }
  for (const k of ["description", "displayOrder", "status", "featured", "active"] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  if (d.featuredRank !== undefined) updates.featuredRank = d.featuredRank;
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined) updates.unpublishedAt = parseDate(d.unpublishedAt);
  // First publish — stamp publishedAt so the visibility filter exposes the row.
  if (
    d.status === "published" &&
    existing.status !== "published" &&
    existing.publishedAt === null &&
    d.publishedAt === undefined
  ) {
    updates.publishedAt = new Date();
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
  res.json(serializeAdminCategory(updated));
});

router.delete("/cms/faq/categories/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.faqCategoriesTable.findFirst({
    where: eq(faqCategoriesTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  // Soft delete — matches the pattern every other artifact uses. Items
  // remain in the DB but are excluded from the visibility filter via
  // `deletedAt`. The `ON DELETE CASCADE` on the items FK only fires on
  // a hard delete, which we no longer do, so each item is soft-deleted
  // explicitly here. That also means a future "restore category"
  // workflow can choose whether to restore items individually instead
  // of resurrecting everything that was attached when the category was
  // removed.
  await db
    .update(faqItemsTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(
      and(
        eq(faqItemsTable.categoryId, id),
        sql`${faqItemsTable.deletedAt} is null`,
      ),
    );
  await db
    .update(faqCategoriesTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(faqCategoriesTable.id, id));
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
  status: z.enum(ARTIFACT_STATUSES).optional(),
  publishedAt: z.string().nullish(),
  unpublishedAt: z.string().nullish(),
  featured: z.boolean().optional(),
  featuredRank: z.number().int().nullish(),
  active: z.boolean().optional(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
});
const ItemPatch = ItemBody.partial();

router.get("/cms/faq/items", ...readGuard, async (req, res) => {
  const categoryId =
    typeof req.query.categoryId === "string" ? req.query.categoryId : null;
  const where = categoryId
    ? and(
        eq(faqItemsTable.categoryId, categoryId),
        sql`${faqItemsTable.deletedAt} is null`,
      )
    : sql`${faqItemsTable.deletedAt} is null`;
  const rows = await db
    .select()
    .from(faqItemsTable)
    .where(where)
    .orderBy(asc(faqItemsTable.displayOrder), asc(faqItemsTable.createdAt));
  res.json({ items: rows.map(serializeAdminItem) });
});

router.post("/cms/faq/items", ...adminGuard, async (req, res) => {
  const parsed = ItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueItemSlug(d.categoryId, d.slug || d.question);
  const status = d.status ?? "published";
  const [row] = await db
    .insert(faqItemsTable)
    .values({
      categoryId: d.categoryId,
      slug,
      title: d.question,
      question: d.question,
      answerHtml: d.answerHtml ?? "",
      displayOrder: d.displayOrder ?? 0,
      status,
      publishedAt:
        parseDate(d.publishedAt) ?? (status === "published" ? new Date() : null),
      unpublishedAt: parseDate(d.unpublishedAt),
      featured: d.featured ?? false,
      featuredRank: d.featuredRank ?? null,
      active: d.active ?? true,
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
  res.status(201).json(serializeAdminItem(row));
});

router.patch("/cms/faq/items/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.faqItemsTable.findFirst({
    where: eq(faqItemsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
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
  if (d.question !== undefined) {
    updates.question = d.question;
    updates.title = d.question;
  }
  for (const k of [
    "answerHtml",
    "displayOrder",
    "status",
    "featured",
    "active",
    "seoTitle",
    "seoDescription",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  if (d.featuredRank !== undefined) updates.featuredRank = d.featuredRank;
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined) updates.unpublishedAt = parseDate(d.unpublishedAt);
  if (
    d.status === "published" &&
    existing.status !== "published" &&
    existing.publishedAt === null &&
    d.publishedAt === undefined
  ) {
    updates.publishedAt = new Date();
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
  res.json(serializeAdminItem(updated));
});

router.delete("/cms/faq/items/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.faqItemsTable.findFirst({
    where: eq(faqItemsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  await db
    .update(faqItemsTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(faqItemsTable.id, id));
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
    .where(
      and(
        eq(faqItemsTable.categoryId, categoryId),
        sql`${faqItemsTable.deletedAt} is null`,
      ),
    );
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
