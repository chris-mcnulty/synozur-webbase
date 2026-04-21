import { and, eq, isNull, ne } from "drizzle-orm";
import {
  db,
  collateralTable,
  servicesTable,
  type Event,
  type Video,
  type WhitePaper,
  type CaseStudy,
  type Application,
  type CollateralPillar,
} from "@workspace/db";
import { toSlug } from "./slug";

// Cache pillar -> primary service id mapping. Services are stable
// enough at runtime that a short in-memory cache avoids a query per
// sync call. Invalidated on process restart.
let servicePillarCache: Map<string, string> | null = null;
async function pillarToServiceId(pillar: string | null): Promise<string | null> {
  if (!pillar) return null;
  if (!servicePillarCache) {
    const rows = await db
      .select({ id: servicesTable.id, blogCategory: servicesTable.blogCategory, slug: servicesTable.slug })
      .from(servicesTable)
      .where(and(eq(servicesTable.active, true), isNull(servicesTable.deletedAt)));
    servicePillarCache = new Map();
    for (const r of rows) {
      if (r.blogCategory) servicePillarCache.set(r.blogCategory.toLowerCase(), r.id);
      if (r.slug) servicePillarCache.set(r.slug.toLowerCase(), r.id);
    }
  }
  return servicePillarCache.get(pillar.toLowerCase()) ?? null;
}

const EVENT_SOURCE_PREFIX = "event:";
const VIDEO_SOURCE_PREFIX = "video:";
const WHITE_PAPER_SOURCE_PREFIX = "white_paper:";
const CASE_STUDY_SOURCE_PREFIX = "case_study:";
const APPLICATION_SOURCE_PREFIX = "application:";

export function eventSourceId(eventId: number): string {
  return `${EVENT_SOURCE_PREFIX}${eventId}`;
}

export function videoSourceId(videoId: string): string {
  return `${VIDEO_SOURCE_PREFIX}${videoId}`;
}

export function whitePaperSourceId(whitePaperId: string): string {
  return `${WHITE_PAPER_SOURCE_PREFIX}${whitePaperId}`;
}

export function caseStudySourceId(caseStudyId: string): string {
  return `${CASE_STUDY_SOURCE_PREFIX}${caseStudyId}`;
}

export function applicationSourceId(applicationId: string): string {
  return `${APPLICATION_SOURCE_PREFIX}${applicationId}`;
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
  const normalizedPillar = normalizePillar(video.pillar);
  const serviceId = await pillarToServiceId(normalizedPillar);

  const syncedFields = {
    type: collateralType as "webinar" | "video",
    title: video.title,
    subtitle: null,
    description: video.shortDescription ?? "",
    heroImage: video.heroImage ?? "",
    pillar: normalizedPillar,
    tags: video.tags ?? [],
    url: `/videos/${video.slug}`,
    external: false,
    publishedAt: video.publishedAt ?? video.recordedAt,
    videoUrl: video.videoUrl || null,
    featured: video.featured,
    featuredRank: video.featuredRank,
    serviceId,
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

export async function upsertCollateralFromWhitePaper(
  whitePaper: WhitePaper,
): Promise<void> {
  const sourceId = whitePaperSourceId(whitePaper.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const isPublished =
    whitePaper.status === "published" && whitePaper.active && !whitePaper.deletedAt;
  const now = new Date();
  const collateralType = whitePaper.docType === "ebook" ? "ebook" : "white_paper";
  const downloadUrl = whitePaper.documentUrl || whitePaper.externalUrl || null;
  const normalizedPillar = normalizePillar(whitePaper.pillar);
  const serviceId = await pillarToServiceId(normalizedPillar);

  const syncedFields = {
    type: collateralType as "white_paper" | "ebook",
    title: whitePaper.title,
    subtitle: whitePaper.subtitle,
    description: whitePaper.shortDescription ?? "",
    heroImage: whitePaper.heroImage ?? "",
    pillar: normalizedPillar,
    tags: whitePaper.tags ?? [],
    url: `/white-papers/${whitePaper.slug}`,
    external: false,
    publishedAt: whitePaper.publishedAt,
    downloadUrl,
    featured: whitePaper.featured,
    featuredRank: whitePaper.featuredRank,
    serviceId,
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

  const slug = await ensureUniqueCollateralSlug(whitePaper.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForWhitePaper(
  whitePaperId: string,
): Promise<void> {
  const sourceId = whitePaperSourceId(whitePaperId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}

export async function upsertCollateralFromCaseStudy(
  caseStudy: CaseStudy,
): Promise<void> {
  const sourceId = caseStudySourceId(caseStudy.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const isPublished =
    caseStudy.status === "published" &&
    caseStudy.active &&
    !caseStudy.deletedAt;
  const now = new Date();

  const syncedFields = {
    type: "case_study" as const,
    title: caseStudy.title,
    subtitle: caseStudy.clientLabel || caseStudy.client || null,
    description: caseStudy.summary,
    heroImage: caseStudy.heroImage,
    tags: [] as string[],
    url: `/case-studies/${caseStudy.slug}`,
    external: false,
    publishedAt: caseStudy.publishedAt,
    featured: caseStudy.featured,
    featuredRank: caseStudy.featuredRank,
    serviceId: caseStudy.serviceId,
    solutionId: caseStudy.solutionId,
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

  const slug = await ensureUniqueCollateralSlug(caseStudy.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForCaseStudy(
  caseStudyId: string,
): Promise<void> {
  const sourceId = caseStudySourceId(caseStudyId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}

// Applications are products, not library artifacts, so they intentionally
// do not sync to `collateralTable`. The helpers below mirror the video /
// white-paper shape so an admin button can trigger a no-op
// reconciliation (useful if a future change does want them in the
// library), but by default they are excluded from /library queries.
export async function upsertCollateralFromApplication(
  _application: Application,
): Promise<void> {
  // Intentional no-op: see comment above.
  return;
}

export async function softDeleteCollateralForApplication(
  _applicationId: string,
): Promise<void> {
  // Intentional no-op.
  return;
}
