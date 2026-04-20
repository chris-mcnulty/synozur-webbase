import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, lte, sql, isNull, inArray } from "drizzle-orm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  db,
  postsTable,
  commentsTable,
  categoriesTable,
  tagsTable,
  postCategories,
  postTags,
  mediaTable,
  usersTable,
} from "@workspace/db";
import { serializePosts } from "../lib/postSerializer";
import { audit } from "../lib/audit";

const router: IRouter = Router();

const ListQuery = z.object({
  categorySlug: z.string().optional(),
  tagSlug: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

router.get("/insights", async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { categorySlug, tagSlug, page, pageSize } = parsed.data;
  const filters = [
    isNull(postsTable.deletedAt),
    eq(postsTable.status, "published"),
    lte(postsTable.publishedAt, new Date()),
  ];
  let restrictPostIds: string[] | null = null;
  if (categorySlug) {
    const ids = await db
      .select({ postId: postCategories.postId })
      .from(postCategories)
      .innerJoin(categoriesTable, eq(postCategories.categoryId, categoriesTable.id))
      .where(eq(categoriesTable.slug, categorySlug));
    restrictPostIds = ids.map((r) => r.postId);
  }
  if (tagSlug) {
    const ids = await db
      .select({ postId: postTags.postId })
      .from(postTags)
      .innerJoin(tagsTable, eq(postTags.tagId, tagsTable.id))
      .where(eq(tagsTable.slug, tagSlug));
    const tagIds = ids.map((r) => r.postId);
    restrictPostIds = restrictPostIds
      ? restrictPostIds.filter((id) => tagIds.includes(id))
      : tagIds;
  }
  if (restrictPostIds !== null) {
    if (restrictPostIds.length === 0) {
      res.json({ items: [], page, pageSize, total: 0 });
      return;
    }
    filters.push(inArray(postsTable.id, restrictPostIds));
  }

  const where = and(...filters);
  const offset = (page - 1) * pageSize;
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(postsTable)
      .where(where)
      .orderBy(desc(postsTable.publishedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(postsTable).where(where),
  ]);

  const fullItems = await serializePosts(items);
  // Public list strips bodyHtml/markdown to keep payload small.
  const publicItems = fullItems.map(({ bodyHtml, bodyMarkdown, ...rest }) => rest);
  res.json({ items: publicItems, page, pageSize, total: totalRow[0]?.c ?? 0 });
});

router.get("/insights/:slug", async (req, res) => {
  const post = await db.query.postsTable.findFirst({
    where: and(
      eq(postsTable.slug, String(req.params.slug)),
      isNull(postsTable.deletedAt),
      eq(postsTable.status, "published"),
    ),
  });
  if (!post || (post.publishedAt && post.publishedAt > new Date())) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [serialized] = await serializePosts([post]);
  res.json(serialized);
});

router.get("/insights/:slug/comments", async (req, res) => {
  const post = await db.query.postsTable.findFirst({
    where: and(
      eq(postsTable.slug, String(req.params.slug)),
      isNull(postsTable.deletedAt),
      eq(postsTable.status, "published"),
    ),
  });
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({
      id: commentsTable.id,
      parentCommentId: commentsTable.parentCommentId,
      authorName: commentsTable.authorName,
      bodyText: commentsTable.bodyText,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .where(and(eq(commentsTable.postId, post.id), eq(commentsTable.status, "approved")))
    .orderBy(commentsTable.createdAt);
  res.json(
    rows.map((r) => ({
      id: r.id,
      parentCommentId: r.parentCommentId,
      authorName: r.authorName,
      bodyText: r.bodyText,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const SubmitBody = z.object({
  authorName: z.string().min(1).max(120),
  authorEmail: z.string().email(),
  bodyText: z.string().min(1).max(5000),
  parentCommentId: z.string().uuid().nullish(),
});

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const xff = Array.isArray(req.headers["x-forwarded-for"])
      ? req.headers["x-forwarded-for"][0]
      : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
    const ip = xff || req.ip || "";
    return ip ? ipKeyGenerator(ip) : ipKeyGenerator(req.ip ?? "0.0.0.0");
  },
  message: { error: "Too many comments submitted. Please try again later." },
});

router.post("/insights/:slug/comments", submitLimiter, async (req, res) => {
  const parsed = SubmitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const post = await db.query.postsTable.findFirst({
    where: and(
      eq(postsTable.slug, String(req.params.slug)),
      isNull(postsTable.deletedAt),
      eq(postsTable.status, "published"),
    ),
  });
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ip =
    (Array.isArray(req.headers["x-forwarded-for"])
      ? req.headers["x-forwarded-for"][0]
      : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()) ||
    req.ip ||
    null;
  const [row] = await db
    .insert(commentsTable)
    .values({
      postId: post.id,
      parentCommentId: parsed.data.parentCommentId ?? null,
      authorName: parsed.data.authorName,
      authorEmail: parsed.data.authorEmail,
      bodyText: parsed.data.bodyText,
      ip,
      userAgent: req.headers["user-agent"] ?? null,
      status: "pending",
    })
    .returning({ id: commentsTable.id, status: commentsTable.status });
  await audit({ action: "comment.submit", entity: "comment", entityId: row.id });
  res.status(202).json({ id: row.id, status: row.status });
});

export default router;
