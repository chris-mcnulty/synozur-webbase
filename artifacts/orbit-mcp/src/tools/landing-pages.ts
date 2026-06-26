import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { landingPagesTable } from "@workspace/db";

export function registerLandingPageTools(server: McpServer) {
  server.tool(
    "list_landing_pages",
    "List published landing pages. Useful for understanding the site's campaign-specific pages when planning content.",
    {
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    },
    async ({ page, pageSize }) => {
      const offset = (page - 1) * pageSize;

      const pages = await db
        .select({
          id: landingPagesTable.id,
          slug: landingPagesTable.slug,
          title: landingPagesTable.title,
          subtitle: landingPagesTable.subtitle,
          description: landingPagesTable.description,
          pillar: landingPagesTable.pillar,
          tags: landingPagesTable.tags,
          seoTitle: landingPagesTable.seoTitle,
          seoDescription: landingPagesTable.seoDescription,
          publishedAt: landingPagesTable.publishedAt,
          featuredRank: landingPagesTable.featuredRank,
        })
        .from(landingPagesTable)
        .where(and(eq(landingPagesTable.status, "published"), isNull(landingPagesTable.deletedAt)))
        .orderBy(desc(landingPagesTable.publishedAt))
        .limit(pageSize)
        .offset(offset);

      const items = pages.map((p) => ({ ...p, publishedAt: p.publishedAt?.toISOString() ?? null }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ items, page, pageSize }) }] };
    },
  );
}
