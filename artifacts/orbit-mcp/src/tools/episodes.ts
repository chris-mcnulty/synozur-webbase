import { z } from "zod";
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../db.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  polarisEpisodesTable,
  postsTable,
} from "@workspace/db";

export function registerEpisodeTools(server: McpServer) {
  server.tool(
    "list_episodes",
    "List published Polaris podcast episodes, most recent first.",
    {
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(12),
    },
    async ({ page, pageSize }) => {
      const offset = (page - 1) * pageSize;

      const episodes = await db
        .select({
          id: polarisEpisodesTable.id,
          slug: polarisEpisodesTable.slug,
          episodeNumber: polarisEpisodesTable.episodeNumber,
          title: polarisEpisodesTable.title,
          guestName: polarisEpisodesTable.guestName,
          summary: polarisEpisodesTable.summary,
          durationSeconds: polarisEpisodesTable.durationSeconds,
          audioUrl: polarisEpisodesTable.audioUrl,
          artworkUrl: polarisEpisodesTable.artworkUrl,
          publishedAt: polarisEpisodesTable.publishedAt,
          status: polarisEpisodesTable.status,
          featured: polarisEpisodesTable.featured,
        })
        .from(polarisEpisodesTable)
        .where(
          and(
            eq(polarisEpisodesTable.status, "published"),
            lte(polarisEpisodesTable.publishedAt, new Date()),
            isNull(polarisEpisodesTable.deletedAt),
          ),
        )
        .orderBy(desc(polarisEpisodesTable.publishedAt))
        .limit(pageSize)
        .offset(offset);

      const items = episodes.map((e) => ({
        ...e,
        publishedAt: e.publishedAt?.toISOString() ?? null,
      }));

      return { content: [{ type: "text" as const, text: JSON.stringify({ items, page, pageSize }) }] };
    },
  );

  server.tool(
    "get_episode",
    "Get full details for a Polaris podcast episode by slug. Includes guest info, all platform URLs, service/solution associations, and optionally the full transcript HTML.",
    {
      slug: z.string().describe("Episode slug"),
      includeTranscript: z.boolean().default(false).describe("Set to true to include the full transcriptHtml field. Transcripts can be large; omit for browse/discovery flows."),
    },
    async ({ slug, includeTranscript }) => {
      const [episode] = await db
        .select()
        .from(polarisEpisodesTable)
        .where(and(eq(polarisEpisodesTable.slug, slug), isNull(polarisEpisodesTable.deletedAt)));

      if (!episode) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Episode not found" }) }], isError: true };
      }

      let linkedPost: { id: string; slug: string; title: string; excerpt: string | null; publishedAt: string | null } | null = null;
      if (episode.linkedPostId) {
        const [post] = await db
          .select({ id: postsTable.id, slug: postsTable.slug, title: postsTable.title, excerpt: postsTable.excerpt, publishedAt: postsTable.publishedAt })
          .from(postsTable)
          .where(and(eq(postsTable.id, episode.linkedPostId), isNull(postsTable.deletedAt)));
        if (post) {
          linkedPost = { ...post, publishedAt: post.publishedAt?.toISOString() ?? null };
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: episode.id,
            slug: episode.slug,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            guestName: episode.guestName ?? null,
            summary: episode.summary,
            durationSeconds: episode.durationSeconds ?? null,
            audioUrl: episode.audioUrl,
            appleUrl: episode.appleUrl ?? null,
            spotifyUrl: episode.spotifyUrl ?? null,
            artworkUrl: episode.artworkUrl,
            serviceId: episode.serviceId ?? null,
            solutionId: episode.solutionId ?? null,
            linkedPost,
            status: episode.status,
            publishedAt: episode.publishedAt?.toISOString() ?? null,
            featured: episode.featured,
            seoTitle: episode.seoTitle ?? null,
            seoDescription: episode.seoDescription ?? null,
            createdAt: episode.createdAt.toISOString(),
            updatedAt: episode.updatedAt.toISOString(),
            ...(includeTranscript ? { transcriptHtml: episode.transcriptHtml ?? null } : {}),
          }),
        }],
      };
    },
  );
}
