import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte, sql, isNull } from "drizzle-orm";
import {
  db,
  postsTable,
  postViewsTable,
  commentsTable,
} from "@workspace/db";
import { requireAuth, hasRole } from "../../middlewares/auth";

const router: IRouter = Router();

const RangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

function rangeStart(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

function authorScopeFilter(user: NonNullable<Express.Request["authedUser"]>) {
  if (hasRole(user, "admin", "editor")) return undefined;
  return eq(postsTable.authorId, user.id);
}

router.get("/cms/analytics/overview", requireAuth, async (req, res) => {
  const parsed = RangeQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { days } = parsed.data;
  const user = req.authedUser!;
  const since = rangeStart(days);
  const scope = authorScopeFilter(user);

  // Totals: views in window, total published posts (in scope), comments in window.
  const totalsViewsRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postViewsTable)
    .innerJoin(postsTable, eq(postViewsTable.postId, postsTable.id))
    .where(
      and(
        isNull(postsTable.deletedAt),
        gte(postViewsTable.viewedAt, since),
        ...(scope ? [scope] : []),
      ),
    );

  const publishedRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postsTable)
    .where(
      and(
        isNull(postsTable.deletedAt),
        eq(postsTable.status, "published"),
        ...(scope ? [scope] : []),
      ),
    );

  const commentsRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(commentsTable)
    .innerJoin(postsTable, eq(commentsTable.postId, postsTable.id))
    .where(
      and(
        isNull(postsTable.deletedAt),
        gte(commentsTable.createdAt, since),
        ...(scope ? [scope] : []),
      ),
    );

  // Top 5 posts by views in window.
  const topPosts = await db
    .select({
      id: postsTable.id,
      slug: postsTable.slug,
      title: postsTable.title,
      publishedAt: postsTable.publishedAt,
      views: sql<number>`count(${postViewsTable.id})::int`,
    })
    .from(postsTable)
    .leftJoin(
      postViewsTable,
      and(eq(postViewsTable.postId, postsTable.id), gte(postViewsTable.viewedAt, since)),
    )
    .where(
      and(
        isNull(postsTable.deletedAt),
        eq(postsTable.status, "published"),
        ...(scope ? [scope] : []),
      ),
    )
    .groupBy(postsTable.id)
    .orderBy(desc(sql`count(${postViewsTable.id})`))
    .limit(5);

  // Daily series (totals across in-scope posts).
  const series = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${postViewsTable.viewedAt}), 'YYYY-MM-DD')`,
      views: sql<number>`count(*)::int`,
    })
    .from(postViewsTable)
    .innerJoin(postsTable, eq(postViewsTable.postId, postsTable.id))
    .where(
      and(
        isNull(postsTable.deletedAt),
        gte(postViewsTable.viewedAt, since),
        ...(scope ? [scope] : []),
      ),
    )
    .groupBy(sql`date_trunc('day', ${postViewsTable.viewedAt})`)
    .orderBy(sql`date_trunc('day', ${postViewsTable.viewedAt})`);

  // Activity feed: recent comments + recent publishes within window.
  const recentComments = await db
    .select({
      kind: sql<string>`'comment'`,
      postId: commentsTable.postId,
      postTitle: postsTable.title,
      postSlug: postsTable.slug,
      authorName: commentsTable.authorName,
      status: commentsTable.status,
      at: commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(postsTable, eq(commentsTable.postId, postsTable.id))
    .where(
      and(
        isNull(postsTable.deletedAt),
        gte(commentsTable.createdAt, since),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(desc(commentsTable.createdAt))
    .limit(20);

  const recentPublishes = await db
    .select({
      kind: sql<string>`'publish'`,
      postId: postsTable.id,
      postTitle: postsTable.title,
      postSlug: postsTable.slug,
      authorName: sql<string | null>`null`,
      status: sql<string>`'published'`,
      at: postsTable.publishedAt,
    })
    .from(postsTable)
    .where(
      and(
        isNull(postsTable.deletedAt),
        eq(postsTable.status, "published"),
        gte(postsTable.publishedAt, since),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(desc(postsTable.publishedAt))
    .limit(20);

  const activity = [...recentComments, ...recentPublishes]
    .filter((e) => e.at)
    .sort((a, b) => (b.at as Date).getTime() - (a.at as Date).getTime())
    .slice(0, 15)
    .map((e) => ({
      kind: e.kind as "comment" | "publish",
      postId: e.postId,
      postTitle: e.postTitle,
      postSlug: e.postSlug,
      authorName: e.authorName ?? null,
      status: e.status,
      at: (e.at as Date).toISOString(),
    }));

  res.json({
    rangeDays: days,
    totals: {
      views: totalsViewsRow[0]?.c ?? 0,
      published: publishedRow[0]?.c ?? 0,
      comments: commentsRow[0]?.c ?? 0,
    },
    topPosts: topPosts.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
      views: p.views,
    })),
    series: series.map((d) => ({ day: d.day, views: d.views })),
    activity,
  });
});

router.get("/cms/analytics/posts/:id", requireAuth, async (req, res) => {
  const parsed = RangeQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { days } = parsed.data;
  const user = req.authedUser!;
  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, String(req.params.id)),
  });
  if (!post || post.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!hasRole(user, "admin", "editor") && post.authorId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const since = rangeStart(days);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postViewsTable)
    .where(and(eq(postViewsTable.postId, post.id), gte(postViewsTable.viewedAt, since)));

  const allTimeRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postViewsTable)
    .where(eq(postViewsTable.postId, post.id));

  const series = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${postViewsTable.viewedAt}), 'YYYY-MM-DD')`,
      views: sql<number>`count(*)::int`,
    })
    .from(postViewsTable)
    .where(and(eq(postViewsTable.postId, post.id), gte(postViewsTable.viewedAt, since)))
    .groupBy(sql`date_trunc('day', ${postViewsTable.viewedAt})`)
    .orderBy(sql`date_trunc('day', ${postViewsTable.viewedAt})`);

  const referrers = await db
    .select({
      host: sql<string>`coalesce(${postViewsTable.referrerHost}, '(direct)')`,
      views: sql<number>`count(*)::int`,
    })
    .from(postViewsTable)
    .where(and(eq(postViewsTable.postId, post.id), gte(postViewsTable.viewedAt, since)))
    .groupBy(sql`coalesce(${postViewsTable.referrerHost}, '(direct)')`)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const commentsCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(commentsTable)
    .where(and(eq(commentsTable.postId, post.id), gte(commentsTable.createdAt, since)));

  res.json({
    post: {
      id: post.id,
      slug: post.slug,
      title: post.title,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    },
    rangeDays: days,
    totals: {
      views: totalRow[0]?.c ?? 0,
      viewsAllTime: allTimeRow[0]?.c ?? 0,
      comments: commentsCount[0]?.c ?? 0,
    },
    series: series.map((d) => ({ day: d.day, views: d.views })),
    referrers: referrers.map((r) => ({ host: r.host, views: r.views })),
  });
});

export default router;
