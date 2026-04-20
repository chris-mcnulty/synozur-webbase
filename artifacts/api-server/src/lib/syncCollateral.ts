import { and, eq, ne } from "drizzle-orm";
import {
  db,
  collateralTable,
  type Event,
  type Video,
  type CollateralPillar,
} from "@workspace/db";
import { toSlug } from "./slug";

const EVENT_SOURCE_PREFIX = "event:";
const VIDEO_SOURCE_PREFIX = "video:";

export function eventSourceId(eventId: number): string {
  return `${EVENT_SOURCE_PREFIX}${eventId}`;
}

export function videoSourceId(videoId: string): string {
  return `${VIDEO_SOURCE_PREFIX}${videoId}`;
}

async function ensureUniqueCollateralSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    const found = await db.query.collateralTable.findFirst({
      where: excludeId
        ? and(eq(collateralTable.slug, slug), ne(collateralTable.id, excludeId))
        : eq(collateralTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

export async function upsertCollateralFromEvent(
  event: Event,
  imageUrl: string | null,
): Promise<void> {
  const sourceId = eventSourceId(event.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const active = event.status !== "CANCELLED";
  const now = new Date();

  const syncedFields = {
    type: "event" as const,
    title: event.title,
    subtitle: event.location ?? null,
    description: event.description ?? "",
    heroImage: imageUrl ?? "",
    url: event.registrationUrl ?? "",
    external: Boolean(event.registrationUrl),
    publishedAt: event.startDate,
    active,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(collateralTable)
      .set({
        ...syncedFields,
        deletedAt: null,
      })
      .where(eq(collateralTable.id, existing.id));
    return;
  }

  const slug = await ensureUniqueCollateralSlug(event.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    tags: [],
    featured: false,
    featuredRank: null,
    sourceId,
  });
}

export async function softDeleteCollateralForEvent(eventId: number): Promise<void> {
  const sourceId = eventSourceId(eventId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}

const ALLOWED_PILLARS: readonly CollateralPillar[] = [
  "strategic",
  "technology",
  "experiences",
  "gtm",
];

function normalizePillar(pillar: string | null | undefined): CollateralPillar | null {
  if (!pillar) return null;
  return (ALLOWED_PILLARS as readonly string[]).includes(pillar)
    ? (pillar as CollateralPillar)
    : null;
}

export async function upsertCollateralFromVideo(video: Video): Promise<void> {
  const sourceId = videoSourceId(video.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const isPublished = video.status === "published" && video.active && !video.deletedAt;
  const now = new Date();
  const collateralType = video.category === "webinar" ? "webinar" : "video";

  const syncedFields = {
    type: collateralType as "webinar" | "video",
    title: video.title,
    subtitle: null,
    description: video.shortDescription ?? "",
    heroImage: video.heroImage ?? "",
    pillar: normalizePillar(video.pillar),
    tags: video.tags ?? [],
    url: `/videos/${video.slug}`,
    external: false,
    publishedAt: video.publishedAt ?? video.recordedAt,
    videoUrl: video.videoUrl || null,
    featured: video.featured,
    featuredRank: video.featuredRank,
    active: isPublished,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(collateralTable)
      .set({
        ...syncedFields,
        deletedAt: isPublished ? null : existing.deletedAt,
      })
      .where(eq(collateralTable.id, existing.id));
    return;
  }

  const slug = await ensureUniqueCollateralSlug(video.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForVideo(videoId: string): Promise<void> {
  const sourceId = videoSourceId(videoId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}
