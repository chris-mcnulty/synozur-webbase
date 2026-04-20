import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql, isNull, inArray } from "drizzle-orm";
import {
  db,
  postsTable,
  postCategories,
  postTags,
  revisionsTable,
} from "@workspace/db";
import { z } from "zod";
import { requireAuth, hasRole } from "../../middlewares/auth";
import { toSlug } from "../../lib/slug";
import { audit } from "../../lib/audit";
import { serializePost, serializePosts } from "../../lib/postSerializer";

const router: IRouter = Router();

const ListQuery = z.object({
  status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
  authorId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateBody = z.object({
  title: z.string().min(1),
  slug: z.string().nullish(),
  subtitle: z.string().nullish(),
  bodyHtml: z.string().nullish(),
  bodyMarkdown: z.string().nullish(),
  excerpt: z.string().nullish(),
  heroImageId: z.string().uuid().nullish(),
  ogImageId: z.string().uuid().nullish(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  seoCanonicalUrl: z.string().nullish(),
  readingTimeMin: z.number().int().nullish(),
  categoryIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

const UpdateBody = CreateBody.partial();

async function ensureUniqueSlug(base: string, excludePostId?: string): Promise<string> {
  let slug = base;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.postsTable.findFirst({
      where: excludePostId
        ? and(eq(postsTable.slug, slug), sql`${postsTable.id} <> ${excludePostId}`)
        : eq(postsTable.slug, slug),
    });
    if (!found) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

async function syncTaxonomy(postId: string, categoryIds?: string[], tagIds?: string[]) {
  if (categoryIds !== undefined) {
    await db.delete(postCategories).where(eq(postCategories.postId, postId));
    if (categoryIds.length) {
      await db
        .insert(postCategories)
        .values(categoryIds.map((categoryId) => ({ postId, categoryId })))
        .onConflictDoNothing();
    }
  }
  if (tagIds !== undefined) {
    await db.delete(postTags).where(eq(postTags.postId, postId));
    if (tagIds.length) {
      await db
        .insert(postTags)
        .values(tagIds.map((tagId) => ({ postId, tagId })))
        .onConflictDoNothing();
    }
  }
}

function canEdit(user: NonNullable<Express.Request["authedUser"]>, post: typeof postsTable.$inferSelect): boolean {
  if (hasRole(user, "admin", "editor")) return true;
  if (hasRole(user, "author", "contributor") && post.authorId === user.id) return true;
  return false;
}

function canPublish(user: NonNullable<Express.Request["authedUser"]>): boolean {
  return hasRole(user, "admin", "editor");
}

router.get("/cms/posts", requireAuth, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  const { status, authorId, search, page, pageSize } = parsed.data;
  const filters = [isNull(postsTable.deletedAt)];
  if (status) filters.push(eq(postsTable.status, status));
  if (authorId) filters.push(eq(postsTable.authorId, authorId));
  if (search) {
    const like = `%${search}%`;
    filters.push(or(ilike(postsTable.title, like), ilike(postsTable.slug, like))!);
  }

  // Authors/contributors can only see their own posts.
  const user = req.authedUser!;
  if (!hasRole(user, "admin", "editor")) {
    filters.push(eq(postsTable.authorId, user.id));
  }

  const where = and(...filters);
  const offset = (page - 1) * pageSize;
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(postsTable)
      .where(where)
      .orderBy(desc(postsTable.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(postsTable).where(where),
  ]);
  const serialized = await serializePosts(items);
  res.json({ items: serialized, page, pageSize, total: totalRow[0]?.c ?? 0 });
});

router.post("/cms/posts", requireAuth, async (req, res) => {
  const user = req.authedUser!;
  if (!hasRole(user, "admin", "editor", "author", "contributor")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const slug = await ensureUniqueSlug(toSlug(data.slug || data.title));
  const [post] = await db
    .insert(postsTable)
    .values({
      slug,
      title: data.title,
      subtitle: data.subtitle ?? null,
      bodyHtml: data.bodyHtml ?? null,
      bodyMarkdown: data.bodyMarkdown ?? null,
      excerpt: data.excerpt ?? null,
      heroImageId: data.heroImageId ?? null,
      ogImageId: data.ogImageId ?? null,
      seoTitle: data.seoTitle ?? null,
      seoDescription: data.seoDescription ?? null,
      seoCanonicalUrl: data.seoCanonicalUrl ?? null,
      readingTimeMin: data.readingTimeMin ?? null,
      authorId: user.id,
      status: "draft",
    })
    .returning();
  await syncTaxonomy(post.id, data.categoryIds, data.tagIds);
  await audit({ actorId: user.id, action: "post.create", entity: "post", entityId: post.id });
  res.status(201).json(await serializePost(post));
});

router.get("/cms/posts/:id", requireAuth, async (req, res) => {
  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, String(req.params.id)),
  });
  if (!post || post.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const user = req.authedUser!;
  if (!hasRole(user, "admin", "editor") && post.authorId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(await serializePost(post));
});

router.patch("/cms/posts/:id", requireAuth, async (req, res) => {
  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, String(req.params.id)),
  });
  if (!post || post.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const user = req.authedUser!;
  if (!canEdit(user, post)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const newSlug = d.slug ? await ensureUniqueSlug(toSlug(d.slug), post.id) : undefined;

  // Snapshot prior state into revisions.
  await db.insert(revisionsTable).values({
    postId: post.id,
    snapshotJson: post as never,
    editedBy: user.id,
  });

  const updates: Partial<typeof postsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (d.title !== undefined) updates.title = d.title!;
  if (newSlug) updates.slug = newSlug;
  if (d.subtitle !== undefined) updates.subtitle = d.subtitle ?? null;
  if (d.bodyHtml !== undefined) updates.bodyHtml = d.bodyHtml ?? null;
  if (d.bodyMarkdown !== undefined) updates.bodyMarkdown = d.bodyMarkdown ?? null;
  if (d.excerpt !== undefined) updates.excerpt = d.excerpt ?? null;
  if (d.heroImageId !== undefined) updates.heroImageId = d.heroImageId ?? null;
  if (d.ogImageId !== undefined) updates.ogImageId = d.ogImageId ?? null;
  if (d.seoTitle !== undefined) updates.seoTitle = d.seoTitle ?? null;
  if (d.seoDescription !== undefined) updates.seoDescription = d.seoDescription ?? null;
  if (d.seoCanonicalUrl !== undefined) updates.seoCanonicalUrl = d.seoCanonicalUrl ?? null;
  if (d.readingTimeMin !== undefined) updates.readingTimeMin = d.readingTimeMin ?? null;

  const [updated] = await db
    .update(postsTable)
    .set(updates)
    .where(eq(postsTable.id, post.id))
    .returning();

  await syncTaxonomy(post.id, d.categoryIds, d.tagIds);
  await audit({ actorId: user.id, action: "post.update", entity: "post", entityId: post.id });
  res.json(await serializePost(updated));
});

router.delete("/cms/posts/:id", requireAuth, async (req, res) => {
  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, String(req.params.id)),
  });
  if (!post || post.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const user = req.authedUser!;
  if (!canEdit(user, post)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await db
    .update(postsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(postsTable.id, post.id));
  await audit({ actorId: user.id, action: "post.delete", entity: "post", entityId: post.id });
  res.status(204).end();
});

router.post("/cms/posts/:id/publish", requireAuth, async (req, res) => {
  const user = req.authedUser!;
  if (!canPublish(user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, String(req.params.id)),
  });
  if (!post || post.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [updated] = await db
    .update(postsTable)
    .set({
      status: "published",
      publishedAt: post.publishedAt ?? new Date(),
      scheduledFor: null,
      updatedAt: new Date(),
    })
    .where(eq(postsTable.id, post.id))
    .returning();
  await audit({ actorId: user.id, action: "post.publish", entity: "post", entityId: post.id });
  res.json(await serializePost(updated));
});

router.post("/cms/posts/:id/schedule", requireAuth, async (req, res) => {
  const user = req.authedUser!;
  if (!canPublish(user) && !hasRole(user, "author")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const Body = z.object({ scheduledFor: z.coerce.date() });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, String(req.params.id)),
  });
  if (!post || post.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canEdit(user, post)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const when = parsed.data.scheduledFor;
  const status = when <= new Date() ? "published" : "scheduled";
  const [updated] = await db
    .update(postsTable)
    .set({
      status,
      scheduledFor: status === "scheduled" ? when : null,
      publishedAt: status === "published" ? when : post.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(postsTable.id, post.id))
    .returning();
  await audit({
    actorId: user.id,
    action: "post.schedule",
    entity: "post",
    entityId: post.id,
    diff: { scheduledFor: when.toISOString() },
  });
  res.json(await serializePost(updated));
});

router.post("/cms/posts/:id/archive", requireAuth, async (req, res) => {
  const user = req.authedUser!;
  if (!canPublish(user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, String(req.params.id)),
  });
  if (!post || post.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [updated] = await db
    .update(postsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(postsTable.id, post.id))
    .returning();
  await audit({ actorId: user.id, action: "post.archive", entity: "post", entityId: post.id });
  res.json(await serializePost(updated));
});

export default router;
