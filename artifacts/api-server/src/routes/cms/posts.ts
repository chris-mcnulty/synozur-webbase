import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql, isNull, inArray } from "drizzle-orm";
import {
  db,
  postsTable,
  postCategories,
  postTags,
  revisionsTable,
  usersTable,
  mediaTable,
} from "@workspace/db";
import { z } from "zod";
import { requireAuth, hasRole } from "../../middlewares/auth";
import { toSlug } from "../../lib/slug";
import { audit } from "../../lib/audit";
import { serializePost, serializePosts } from "../../lib/postSerializer";
import { setCategoriesFor, setTagsFor } from "../../lib/taxonomy";
import {
  upsertCollateralFromPost,
  softDeleteCollateralForPost,
} from "../../lib/syncCollateral";

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
  featured: z.boolean().optional(),
  featuredRank: z.number().int().nullish(),
  categoryIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  authorId: z.string().uuid().optional(),
});

const UpdateBody = CreateBody.partial();

// Sync-to-collateral is a best-effort side effect. A failure here must not
// block the main post mutation — the sync job can be re-triggered by the
// next save, and the underlying post is the source of truth.
async function syncPostCollateral(post: typeof postsTable.$inferSelect): Promise<void> {
  try {
    const isEligibleForCollateral = post.status === "published" && post.featured === true;
    if (!isEligibleForCollateral) {
      await softDeleteCollateralForPost(post.id);
      return;
    }
    let heroUrl: string | null = null;
    if (post.heroImageId) {
      const row = await db
        .select({ publicUrl: mediaTable.publicUrl })
        .from(mediaTable)
        .where(eq(mediaTable.id, post.heroImageId))
        .limit(1);
      heroUrl = row[0]?.publicUrl ?? null;
    }
    await upsertCollateralFromPost(post, heroUrl);
  } catch (err) {
    console.error("upsertCollateralFromPost failed", { postId: post.id, err });
  }
}

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
    // Also write through to the polymorphic taxonomy tables so rails and
    // tag-landing pages that read from entity_* see the same truth as the
    // legacy post_* tables (#99 / #100.5).
    await setCategoriesFor("post", postId, categoryIds);
  }
  if (tagIds !== undefined) {
    await db.delete(postTags).where(eq(postTags.postId, postId));
    if (tagIds.length) {
      await db
        .insert(postTags)
        .values(tagIds.map((tagId) => ({ postId, tagId })))
        .onConflictDoNothing();
    }
    await setTagsFor("post", postId, tagIds);
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
      .orderBy(sql`${postsTable.publishedAt} DESC NULLS LAST`, desc(postsTable.updatedAt))
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
      featured: data.featured ?? false,
      featuredRank: data.featuredRank ?? null,
      authorId: hasRole(user, "admin", "editor") && data.authorId ? data.authorId : user.id,
      status: "draft",
    })
    .returning();
  await syncTaxonomy(post.id, data.categoryIds, data.tagIds);
  await syncPostCollateral(post);
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
  if (d.featured !== undefined) updates.featured = d.featured;
  if (d.featuredRank !== undefined) updates.featuredRank = d.featuredRank ?? null;
  if (d.authorId && hasRole(user, "admin", "editor")) updates.authorId = d.authorId;

  const [updated] = await db
    .update(postsTable)
    .set(updates)
    .where(eq(postsTable.id, post.id))
    .returning();

  await syncTaxonomy(post.id, d.categoryIds, d.tagIds);
  await syncPostCollateral(updated);
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
  try {
    await softDeleteCollateralForPost(post.id);
  } catch (err) {
    console.error("softDeleteCollateralForPost failed", { postId: post.id, err });
  }
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
  await syncPostCollateral(updated);
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
  await syncPostCollateral(updated);
  await audit({
    actorId: user.id,
    action: "post.schedule",
    entity: "post",
    entityId: post.id,
    diff: { scheduledFor: when.toISOString() },
  });
  res.json(await serializePost(updated));
});

type PostRow = typeof postsTable.$inferSelect;

const RESTORABLE_FIELDS = [
  "title",
  "slug",
  "subtitle",
  "bodyHtml",
  "bodyMarkdown",
  "excerpt",
  "heroImageId",
  "ogImageId",
  "seoTitle",
  "seoDescription",
  "seoCanonicalUrl",
  "readingTimeMin",
] as const;

router.get("/cms/posts/:id/revisions", requireAuth, async (req, res) => {
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
  const rows = await db
    .select({
      id: revisionsTable.id,
      postId: revisionsTable.postId,
      editedAt: revisionsTable.editedAt,
      editedBy: revisionsTable.editedBy,
      snapshotJson: revisionsTable.snapshotJson,
      editorId: usersTable.id,
      editorDisplayName: usersTable.displayName,
      editorAvatarUrl: usersTable.avatarUrl,
    })
    .from(revisionsTable)
    .leftJoin(usersTable, eq(usersTable.id, revisionsTable.editedBy))
    .where(eq(revisionsTable.postId, post.id))
    .orderBy(desc(revisionsTable.editedAt));

  res.json(
    rows.map((r) => {
      const snap = (r.snapshotJson ?? {}) as Partial<PostRow>;
      return {
        id: r.id,
        postId: r.postId,
        editedAt: r.editedAt.toISOString(),
        editor: r.editorId
          ? {
              id: r.editorId,
              displayName: r.editorDisplayName ?? null,
              avatarUrl: r.editorAvatarUrl ?? null,
            }
          : null,
        snapshotTitle: snap.title ?? null,
        snapshotExcerpt: snap.excerpt ?? null,
      };
    }),
  );
});

// #66/#67: full snapshot for preview and diff. The list endpoint only
// returns summary fields; reading the body of a revision is an on-demand
// fetch so the listing stays cheap and the bodyHtml only travels when an
// editor actually opens preview/diff.
router.get(
  "/cms/posts/:id/revisions/:revisionId",
  requireAuth,
  async (req, res) => {
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
    const row = await db
      .select({
        id: revisionsTable.id,
        postId: revisionsTable.postId,
        editedAt: revisionsTable.editedAt,
        snapshotJson: revisionsTable.snapshotJson,
        editorId: usersTable.id,
        editorDisplayName: usersTable.displayName,
        editorAvatarUrl: usersTable.avatarUrl,
      })
      .from(revisionsTable)
      .leftJoin(usersTable, eq(usersTable.id, revisionsTable.editedBy))
      .where(
        and(
          eq(revisionsTable.id, String(req.params.revisionId)),
          eq(revisionsTable.postId, post.id),
        ),
      )
      .limit(1);
    const r = row[0];
    if (!r) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    const snap = (r.snapshotJson ?? {}) as Partial<PostRow>;
    res.json({
      id: r.id,
      postId: r.postId,
      editedAt: r.editedAt.toISOString(),
      editor: r.editorId
        ? {
            id: r.editorId,
            displayName: r.editorDisplayName ?? null,
            avatarUrl: r.editorAvatarUrl ?? null,
          }
        : null,
      snapshotTitle: snap.title ?? null,
      snapshotSubtitle: snap.subtitle ?? null,
      snapshotExcerpt: snap.excerpt ?? null,
      snapshotBodyHtml: snap.bodyHtml ?? null,
      snapshotBodyMarkdown: snap.bodyMarkdown ?? null,
      snapshotSlug: snap.slug ?? null,
      snapshotSeoTitle: snap.seoTitle ?? null,
      snapshotSeoDescription: snap.seoDescription ?? null,
    });
  },
);

router.post(
  "/cms/posts/:id/revisions/:revisionId/restore",
  requireAuth,
  async (req, res) => {
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
    const revision = await db.query.revisionsTable.findFirst({
      where: and(
        eq(revisionsTable.id, String(req.params.revisionId)),
        eq(revisionsTable.postId, post.id),
      ),
    });
    if (!revision) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    const snap = (revision.snapshotJson ?? {}) as Partial<PostRow>;

    const updates: Partial<typeof postsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    for (const field of RESTORABLE_FIELDS) {
      if (field in snap) {
        (updates as Record<string, unknown>)[field] =
          (snap as Record<string, unknown>)[field] ?? null;
      }
    }
    if (typeof updates.slug === "string" && updates.slug !== post.slug) {
      updates.slug = await ensureUniqueSlug(toSlug(updates.slug), post.id);
    }

    // Wrap snapshot + update in a transaction so a failure in either step
    // does not leave the data in an inconsistent state.
    const [updated] = await db.transaction(async (tx) => {
      // Snapshot the current persisted state before overwriting it so the
      // editor can roll back the restore from the revisions panel.
      await tx.insert(revisionsTable).values({
        postId: post.id,
        snapshotJson: post as never,
        editedBy: user.id,
      });

      return tx
        .update(postsTable)
        .set(updates)
        .where(eq(postsTable.id, post.id))
        .returning();
    });

    await audit({
      actorId: user.id,
      action: "post.revision.restore",
      entity: "post",
      entityId: post.id,
      diff: { revisionId: revision.id },
    });
    res.json(await serializePost(updated));
  },
);

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
  await syncPostCollateral(updated);
  await audit({ actorId: user.id, action: "post.archive", entity: "post", entityId: post.id });
  res.json(await serializePost(updated));
});

export default router;
