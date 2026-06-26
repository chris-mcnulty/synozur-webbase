import { isNull, eq } from "drizzle-orm";
import { db, categoriesTable, tagsTable, usersTable, postsTable } from "@workspace/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerTaxonomyTools(server: McpServer) {
  server.tool(
    "list_categories",
    "List all blog post categories.",
    {},
    async () => {
      const categories = await db
        .select({ id: categoriesTable.id, name: categoriesTable.name, slug: categoriesTable.slug, description: categoriesTable.description })
        .from(categoriesTable)
        .orderBy(categoriesTable.name);
      return { content: [{ type: "text" as const, text: JSON.stringify(categories) }] };
    },
  );

  server.tool(
    "list_tags",
    "List all blog post tags.",
    {},
    async () => {
      const tags = await db
        .select({ id: tagsTable.id, name: tagsTable.name, slug: tagsTable.slug })
        .from(tagsTable)
        .orderBy(tagsTable.name);
      return { content: [{ type: "text" as const, text: JSON.stringify(tags) }] };
    },
  );

  server.tool(
    "list_authors",
    "List users who have authored at least one blog post. Use these IDs when calling create_draft_post.",
    {},
    async () => {
      const authors = await db
        .selectDistinct({
          id: usersTable.id,
          displayName: usersTable.displayName,
          email: usersTable.email,
          avatarUrl: usersTable.avatarUrl,
          bio: usersTable.bio,
        })
        .from(usersTable)
        .innerJoin(postsTable, eq(postsTable.authorId, usersTable.id))
        .where(isNull(postsTable.deletedAt))
        .orderBy(usersTable.displayName);
      return { content: [{ type: "text" as const, text: JSON.stringify(authors) }] };
    },
  );
}
