import { z } from "zod";
import { and, desc, eq, gte, isNull, lte, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  postsTable,
  categoriesTable,
  tagsTable,
  postCategories,
  postTags,
  postViewsTable,
  usersTable,
  mediaTable,
  teamMembersTable,
} from "@workspace/db";

async function serializePost(post: typeof postsTable.$inferSelect, opts: { includeBody?: boolean } = {}) {
  const authorIds = [post.authorId];
  const mediaIds = [post.heroImageId, post.ogImageId].filter((id): id is string => Boolean(id));

  const [authors, teamMembers, media, categories, tags] = await Promise.all([
    db.select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl, bio: usersTable.bio })
      .from(usersTable)
      .where(inArray(usersTable.id, authorIds)),
    db.select({ userId: teamMembersTable.userId, jobTitle: teamMembersTable.jobTitle, linkedinUrl: teamMembersTable.linkedinUrl, slug: teamMembersTable.slug, imageUrl: teamMembersTable.imageUrl })
      .from(teamMembersTable)
      .where(and(inArray(teamMembersTable.userId, authorIds), eq(teamMembersTable.active, true))),
    mediaIds.length
      ? db.select({ id: mediaTable.id, publicUrl: mediaTable.publicUrl }).from(mediaTable).where(inArray(mediaTable.id, mediaIds))
      : Promise.resolve([]),
    db.select({ id: categoriesTable.id, slug: categoriesTable.slug, name: categoriesTable.name })
      .from(postCategories)
      .innerJoin(categoriesTable, eq(postCategories.categoryId, categoriesTable.id))
      .where(eq(postCategories.postId, post.id)),
    db.select({ id: tagsTable.id, slug: tagsTable.slug, name: tagsTable.name })
      .from(postTags)
      .innerJoin(tagsTable, eq(postTags.tagId, tagsTable.id))
      .where(eq(postTags.postId, post.id)),
  ]);

  const author = authors[0] ?? null;
  const tm = teamMembers.find((m) => m.userId === post.authorId) ?? null;
  const mediaMap = new Map(media.map((m) => [m.id, m.publicUrl]));

  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    subtitle: post.subtitle ?? null,
    excerpt: post.excerpt ?? null,
    ...(opts.includeBody ? { bodyHtml: post.bodyHtml ?? null, bodyMarkdown: post.bodyMarkdown ?? null } : {}),
    heroImageUrl: post.heroImageId ? (mediaMap.get(post.heroImageId) ?? null) : null,
    ogImageUrl: post.ogImageId ? (mediaMap.get(post.ogImageId) ?? null) : null,
    author: author
      ? {
          id: author.id,
          displayName: author.displayName ?? null,
          avatarUrl: tm?.imageUrl ?? author.avatarUrl ?? null,
          bio: author.bio ?? null,
          jobTitle: tm?.jobTitle ?? null,
          linkedinUrl: tm?.linkedinUrl ?? null,
          teamMemberSlug: tm?.slug ?? null,
        }
      : null,
    authorId: post.authorId,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    readingTimeMin: post.readingTimeMin ?? null,
    featured: post.featured,
    featuredRank: post.featuredRank ?? null,
    seoTitle: post.seoTitle ?? null,
    seoDescription: post.seoDescription ?? null,
    categories,
    tags,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function registerPostReadTools(server: McpServer) {
  server.tool(
    "search_posts",
    "Search and list blog posts. Supports full-text query plus filter by category, tag, and status.",
    {
      query: z.string().optional().describe("Full-text search term"),
      categorySlug: z.string().optional().describe("Filter by category slug"),
      tagSlug: z.string().optional().describe("Filter by tag slug"),
      status: z.enum(["draft", "scheduled", "published", "archived"]).optional().describe("Filter by post status. Defaults to published only."),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(12),
    },
    async ({ query, categorySlug, tagSlug, status, page, pageSize }) => {
      const filters = [isNull(postsTable.deletedAt)];

      if (status) {
        filters.push(eq(postsTable.status, status));
      } else {
        filters.push(eq(postsTable.status, "published"), lte(postsTable.publishedAt, new Date()));
      }

      let restrictIds: string[] | null = null;

      if (categorySlug) {
        const rows = await db
          .select({ postId: postCategories.postId })
          .from(postCategories)
          .innerJoin(categoriesTable, eq(postCategories.categoryId, categoriesTable.id))
          .where(eq(categoriesTable.slug, categorySlug));
        restrictIds = rows.map((r) => r.postId);
      }

      if (tagSlug) {
        const rows = await db
          .select({ postId: postTags.postId })
          .from(postTags)
          .innerJoin(tagsTable, eq(postTags.tagId, tagsTable.id))
          .where(eq(tagsTable.slug, tagSlug));
        const tagPostIds = rows.map((r) => r.postId);
        restrictIds = restrictIds ? restrictIds.filter((id) => tagPostIds.includes(id)) : tagPostIds;
      }

      if (query) {
        filters.push(sql`${postsTable.searchTsv} @@ plainto_tsquery('english', ${query})`);
      }

      if (restrictIds !== null) {
        if (restrictIds.length === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ items: [], page, pageSize, total: 0 }) }] };
        }
        filters.push(inArray(postsTable.id, restrictIds));
      }

      const where = and(...filters);
      const offset = (page - 1) * pageSize;

      const [rows, totalRow] = await Promise.all([
        db.select().from(postsTable).where(where).orderBy(desc(postsTable.publishedAt)).limit(pageSize).offset(offset),
        db.select({ c: sql<number>`count(*)::int` }).from(postsTable).where(where),
      ]);

      const items = await Promise.all(rows.map((p) => serializePost(p, { includeBody: false })));
      return { content: [{ type: "text" as const, text: JSON.stringify({ items, page, pageSize, total: totalRow[0]?.c ?? 0 }) }] };
    },
  );

  server.tool(
    "get_post",
    "Get a single blog post by slug, including full body content, SEO fields, author, categories, and tags.",
    {
      slug: z.string().describe("Post slug"),
    },
    async ({ slug }) => {
      const [post] = await db.select().from(postsTable).where(and(eq(postsTable.slug, slug), isNull(postsTable.deletedAt)));
      if (!post) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Post not found" }) }], isError: true };
      const result = await serializePost(post, { includeBody: true });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "get_post_performance",
    "Get traffic analytics for a post: total views, unique sessions, 30-day daily trend, top referrer hosts.",
    {
      slug: z.string().describe("Post slug"),
    },
    async ({ slug }) => {
      const [post] = await db.select({ id: postsTable.id }).from(postsTable).where(and(eq(postsTable.slug, slug), isNull(postsTable.deletedAt)));
      if (!post) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Post not found" }) }], isError: true };

      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 29);
      since.setUTCHours(0, 0, 0, 0);

      const [totalRow, uniqueRow, dailyRows, referrerRows] = await Promise.all([
        db.select({ c: sql<number>`count(*)::int` }).from(postViewsTable).where(eq(postViewsTable.postId, post.id)),
        db.select({ c: sql<number>`count(distinct session_hash)::int` }).from(postViewsTable).where(eq(postViewsTable.postId, post.id)),
        db
          .select({
            date: sql<string>`date_trunc('day', viewed_at)::date::text`,
            views: sql<number>`count(*)::int`,
          })
          .from(postViewsTable)
          .where(and(eq(postViewsTable.postId, post.id), gte(postViewsTable.viewedAt, since)))
          .groupBy(sql`date_trunc('day', viewed_at)`)
          .orderBy(sql`date_trunc('day', viewed_at)`),
        db
          .select({
            host: postViewsTable.referrerHost,
            views: sql<number>`count(*)::int`,
          })
          .from(postViewsTable)
          .where(and(eq(postViewsTable.postId, post.id), sql`referrer_host is not null`))
          .groupBy(postViewsTable.referrerHost)
          .orderBy(desc(sql`count(*)`))
          .limit(5),
      ]);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            postId: post.id,
            slug,
            totalViews: totalRow[0]?.c ?? 0,
            uniqueSessions: uniqueRow[0]?.c ?? 0,
            viewsByDay: dailyRows,
            topReferrers: referrerRows.map((r) => ({ host: r.host, views: r.views })),
          }),
        }],
      };
    },
  );
}
