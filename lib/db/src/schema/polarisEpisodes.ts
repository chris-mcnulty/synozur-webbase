import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import {
  artifactIdentity,
  artifactLifecycle,
  artifactSeo,
  artifactTimestamps,
} from "./_artifactBase";
import { servicesTable, solutionsTable } from "./services";

// Polaris podcast episodes (#101). Built on the shared #98 artifact-type
// pattern: identity + lifecycle + SEO + timestamps reused from
// `_artifactBase.ts`, with domain-specific fields for episode metadata
// (audio, duration, guest, transcript) layered on top.
export const polarisEpisodesTable = pgTable(
  "polaris_episodes",
  {
    ...artifactIdentity,
    episodeNumber: integer("episode_number").notNull(),
    summary: text("summary").notNull().default(""),
    guestName: text("guest_name"),
    audioUrl: text("audio_url").notNull().default(""),
    appleUrl: text("apple_url"),
    spotifyUrl: text("spotify_url"),
    durationSeconds: integer("duration_seconds"),
    transcriptHtml: text("transcript_html"),
    artworkUrl: text("artwork_url").notNull().default(""),
    serviceId: uuid("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
    solutionId: uuid("solution_id").references(() => solutionsTable.id, { onDelete: "set null" }),
    ...artifactLifecycle,
    ...artifactSeo,
    ...artifactTimestamps,
  },
  (t) => [
    uniqueIndex("polaris_episodes_slug_key").on(t.slug),
    uniqueIndex("polaris_episodes_number_key").on(t.episodeNumber),
    index("polaris_episodes_published_at_idx").on(t.publishedAt),
    index("polaris_episodes_featured_rank_idx").on(t.featured, t.featuredRank),
  ],
);

export type PolarisEpisode = typeof polarisEpisodesTable.$inferSelect;
export type InsertPolarisEpisode = typeof polarisEpisodesTable.$inferInsert;
