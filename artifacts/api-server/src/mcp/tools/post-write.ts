import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db, postsTable, postCategories, postTags } from "@workspace/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(title: string): Promise<string> {
  const base = toSlug(title);
  let candidate = base;
  let i = 2;
  for (let attempt = 0; attempt < 50; attempt++) {
    const [existing] = await db.select({ id: postsTable.id }).from(postsTable).where(eq(postsTable.slug, candidate));
    if (!existing) return candidate;
    candidate = `${base}-${i++}`;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export function registerPostWriteTools(server: McpServer) {
  server.tool(
    "create_draft_post",
    "Create a new blog post draft. Returns the new post id and slug. Use list_authors for valid authorId values and list_categories / list_tags for valid category/tag IDs.",
    {
      title: z.string().min(1).describe("Post title"),
      bodyMarkdown: z.string().describe("Post body in Markdown"),
      authorId: z.string().uuid().describe("UUID of the post author from list_authors"),
      categoryIds: z.array(z.string().uuid()).optional().describe("Category UUIDs to assign"),
      tagIds: z.array(z.string().uuid()).optional().describe("Tag UUIDs to assign"),
      excerpt: z.string().optional().describe("Short excerpt (shown in listing cards)"),
      heroImageId: z.string().uuid().optional().describe("Media UUID for the hero image"),
      seoTitle: z.string().optional(),
      seoDescription: z.string().optional(),
    },
    async ({ title, bodyMarkdown, authorId, categoryIds, tagIds, excerpt, heroImageId, seoTitle, seoDescription }) => {
      const slug = await uniqueSlug(title);
      const id = randomUUID();

      await db.insert(postsTable).values({
        id,
        slug,
        title,
        bodyMarkdown,
        authorId,
        excerpt: excerpt ?? null,
        heroImageId: heroImageId ?? null,
        seoTitle: seoTitle ?? null,
        seoDescription: seoDescription ?? null,
        status: "draft",
      });

      if (categoryIds?.length) {
        await db.insert(postCategories).values(categoryIds.map((categoryId) => ({ postId: id, categoryId })));
      }
      if (tagIds?.length) {
        await db.insert(postTags).values(tagIds.map((tagId) => ({ postId: id, tagId })));
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ id, slug, status: "draft", title }) }],
      };
    },
  );

  server.tool(
    "update_draft_post",
    "Update fields on an existing draft or scheduled post. Only operates on drafts and scheduled posts — will not modify published or archived posts.",
    {
      id: z.string().uuid().describe("Post UUID"),
      title: z.string().optional(),
      bodyMarkdown: z.string().optional(),
      excerpt: z.string().optional(),
      heroImageId: z.string().uuid().nullable().optional(),
      categoryIds: z.array(z.string().uuid()).optional().describe("Replaces all existing categories"),
      tagIds: z.array(z.string().uuid()).optional().describe("Replaces all existing tags"),
      seoTitle: z.string().nullable().optional(),
      seoDescription: z.string().nullable().optional(),
    },
    async ({ id, title, bodyMarkdown, excerpt, heroImageId, categoryIds, tagIds, seoTitle, seoDescription }) => {
      const [post] = await db.select({ id: postsTable.id, status: postsTable.status })
        .from(postsTable)
        .where(and(eq(postsTable.id, id), isNull(postsTable.deletedAt)));

      if (!post) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Post not found" }) }], isError: true };
      }
      if (post.status === "published" || post.status === "archived") {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot update a ${post.status} post` }) }], isError: true };
      }

      const updates: Partial<typeof postsTable.$inferInsert> = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (bodyMarkdown !== undefined) updates.bodyMarkdown = bodyMarkdown;
      if (excerpt !== undefined) updates.excerpt = excerpt;
      if (heroImageId !== undefined) updates.heroImageId = heroImageId;
      if (seoTitle !== undefined) updates.seoTitle = seoTitle;
      if (seoDescription !== undefined) updates.seoDescription = seoDescription;

      await db.update(postsTable).set(updates).where(eq(postsTable.id, id));

      if (categoryIds !== undefined) {
        await db.delete(postCategories).where(eq(postCategories.postId, id));
        if (categoryIds.length) {
          await db.insert(postCategories).values(categoryIds.map((categoryId) => ({ postId: id, categoryId })));
        }
      }
      if (tagIds !== undefined) {
        await db.delete(postTags).where(eq(postTags.postId, id));
        if (tagIds.length) {
          await db.insert(postTags).values(tagIds.map((tagId) => ({ postId: id, tagId })));
        }
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ id, updated: true }) }] };
    },
  );

  server.tool(
    "schedule_post",
    "Set a future publish date on a draft post. The post status becomes 'scheduled'. The publish worker will flip it to 'published' at the scheduled time.",
    {
      id: z.string().uuid().describe("Post UUID"),
      scheduledFor: z.string().describe("ISO 8601 datetime string for when the post should publish"),
    },
    async ({ id, scheduledFor }) => {
      const dt = new Date(scheduledFor);
      if (isNaN(dt.getTime())) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid scheduledFor datetime" }) }], isError: true };
      }

      const [post] = await db.select({ id: postsTable.id, status: postsTable.status })
        .from(postsTable)
        .where(and(eq(postsTable.id, id), isNull(postsTable.deletedAt)));

      if (!post) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Post not found" }) }], isError: true };
      }
      if (post.status === "published" || post.status === "archived") {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot schedule a ${post.status} post` }) }], isError: true };
      }

      await db.update(postsTable)
        .set({ status: "scheduled", scheduledFor: dt, updatedAt: new Date() })
        .where(eq(postsTable.id, id));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ id, status: "scheduled", scheduledFor: dt.toISOString() }),
        }],
      };
    },
  );
}
