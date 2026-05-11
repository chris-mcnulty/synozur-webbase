import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  db,
  collateralTable,
  servicesTable,
  solutionsTable,
  assetsTable,
  postCategories,
  postTags,
  categoriesTable,
  tagsTable,
  type Event,
  type Post,
  type Video,
  type WhitePaper,
  type CaseStudy,
  type Application,
  type Model,
  type Workshop,
  type LandingPage,
  type CollateralPillar,
} from "@workspace/db";
import { canonicalUrlForCollateral } from "@workspace/api-zod";
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
const POST_SOURCE_PREFIX = "post:";
const VIDEO_SOURCE_PREFIX = "video:";
const WHITE_PAPER_SOURCE_PREFIX = "white_paper:";
const CASE_STUDY_SOURCE_PREFIX = "case_study:";
const APPLICATION_SOURCE_PREFIX = "application:";
const MODEL_SOURCE_PREFIX = "model:";
const WORKSHOP_SOURCE_PREFIX = "workshop:";
const LANDING_PAGE_SOURCE_PREFIX = "landing_page:";

export function eventSourceId(eventId: number): string {
  return `${EVENT_SOURCE_PREFIX}${eventId}`;
}

export function postSourceId(postId: string): string {
  return `${POST_SOURCE_PREFIX}${postId}`;
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

export function modelSourceId(modelId: string): string {
  return `${MODEL_SOURCE_PREFIX}${modelId}`;
}

export function workshopSourceId(workshopId: string): string {
  return `${WORKSHOP_SOURCE_PREFIX}${workshopId}`;
}

export function landingPageSourceId(landingPageId: string): string {
  return `${LANDING_PAGE_SOURCE_PREFIX}${landingPageId}`;
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

  // Prefer description; fall back to teaser so feature-card copy isn't blank
  // for CSV-imported events (Wix export has no description column).
  const description = event.description?.trim()
    ? event.description
    : (event.teaser ?? "");

  const syncedFields = {
    type: "event" as const,
    title: event.title,
    subtitle: event.location ?? null,
    description,
    heroImage: imageUrl ?? "",
    // When an event is syndicated into the library / carousel, link to our
    // own event page — not the external registration URL. The registration
    // CTA still lives on the event detail page for visitors who want it.
    url: canonicalUrlForCollateral("event", event.slug),
    external: false,
    publishedAt: event.startDate,
    featured: event.featured,
    featuredRank: event.featuredRank,
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
    url: canonicalUrlForCollateral("video", video.slug),
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

// Blog posts only flow into the library when an editor explicitly marks
// them as featured. Most posts stay on /insights only — the library row is
// there to make a handful of high-signal posts discoverable from
// resource-rail queries (e.g. "Resources for AI") and, more rarely, from
// the home-page carousel.
export async function upsertCollateralFromPost(
  post: Post,
  heroImageUrl: string | null,
): Promise<void> {
  const sourceId = postSourceId(post.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const isEligible =
    post.featured && post.status === "published" && !post.deletedAt;

  // A previously-featured post that is now unfeatured / unpublished /
  // deleted should drop out of the library without losing its row, so an
  // editor re-flipping the flag restores it cleanly.
  if (!isEligible) {
    if (existing) {
      await softDeleteCollateralForPost(post.id);
    }
    return;
  }

  // Fetch the post's categories and tags so we can populate the collateral
  // row's `serviceId` and `tags` fields. These are stored in separate join
  // tables and aren't part of the base `Post` row.
  const [categoryRows, tagRows] = await Promise.all([
    db
      .select({ slug: categoriesTable.slug })
      .from(postCategories)
      .innerJoin(categoriesTable, eq(postCategories.categoryId, categoriesTable.id))
      .where(eq(postCategories.postId, post.id)),
    db
      .select({ slug: tagsTable.slug })
      .from(postTags)
      .innerJoin(tagsTable, eq(postTags.tagId, tagsTable.id))
      .where(eq(postTags.postId, post.id)),
  ]);

  // Derive a primary service from the post's categories using the same
  // pillar→service mapping already used by video/white-paper sync.
  let serviceId: string | null = null;
  for (const { slug } of categoryRows) {
    const sid = await pillarToServiceId(slug);
    if (sid) {
      serviceId = sid;
      break;
    }
  }

  const tags = tagRows.map((r) => r.slug);

  // Resolve solutionId: prefer the editor's explicit linked_solution_id,
  // then fall back to matching any tag slug against a live solution slug.
  let solutionId: string | null = post.linkedSolutionId ?? null;
  if (!solutionId && tags.length > 0) {
    const matched = await db
      .select({ id: solutionsTable.id })
      .from(solutionsTable)
      .where(
        and(
          inArray(solutionsTable.slug, tags),
          isNull(solutionsTable.deletedAt),
        ),
      )
      .limit(1);
    solutionId = matched[0]?.id ?? null;
  }

  const now = new Date();
  const syncedFields = {
    type: "insight" as const,
    title: post.title,
    subtitle: post.subtitle ?? null,
    description: post.excerpt ?? "",
    heroImage: heroImageUrl ?? "",
    url: canonicalUrlForCollateral("insight", post.slug),
    external: false,
    publishedAt: post.publishedAt,
    featured: post.featured,
    featuredRank: post.featuredRank,
    serviceId,
    solutionId,
    tags,
    active: true,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(collateralTable)
      .set({ ...syncedFields, deletedAt: null })
      .where(eq(collateralTable.id, existing.id));
    return;
  }

  const slug = await ensureUniqueCollateralSlug(post.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForPost(postId: string): Promise<void> {
  const sourceId = postSourceId(postId);
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
  let uploadedDocumentUrl: string | null = null;
  if (whitePaper.documentAssetId) {
    const [asset] = await db
      .select({ storageKey: assetsTable.storageKey })
      .from(assetsTable)
      .where(eq(assetsTable.id, whitePaper.documentAssetId));
    if (asset) uploadedDocumentUrl = `/api/storage${asset.storageKey}`;
  }
  const downloadUrl =
    uploadedDocumentUrl || whitePaper.documentUrl || whitePaper.externalUrl || null;
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
    url: canonicalUrlForCollateral(collateralType, whitePaper.slug),
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
    url: canonicalUrlForCollateral("case_study", caseStudy.slug),
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

// Applications surface in /library as collateral `type="application"` so they
// can be linked to a service/solution and discovered alongside other content.
// The library card links to the internal detail page (/applications/:slug).
export async function upsertCollateralFromApplication(
  application: Application,
): Promise<void> {
  const sourceId = applicationSourceId(application.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const now = new Date();
  const withinWindow =
    (!application.publishedAt || application.publishedAt <= now) &&
    (!application.unpublishedAt || application.unpublishedAt > now);
  const isPublished =
    application.status === "published" &&
    application.active &&
    !application.deletedAt &&
    withinWindow;

  const syncedFields = {
    type: "application" as const,
    title: application.title,
    subtitle: application.tagline ?? null,
    description: application.shortSummary ?? "",
    heroImage: application.screenshot ?? application.logo ?? "",
    pillar: null as CollateralPillar | null,
    tags: [] as string[],
    url: canonicalUrlForCollateral("application", application.slug),
    external: false,
    publishedAt: application.publishedAt,
    featured: application.featured,
    featuredRank: application.featuredRank,
    serviceId: application.serviceId,
    solutionId: application.solutionId,
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

  const slug = await ensureUniqueCollateralSlug(application.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForApplication(
  applicationId: string,
): Promise<void> {
  const sourceId = applicationSourceId(applicationId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}

// Models (#106). Flow into the library as collateral `type="model"` so a
// featured model can surface on the home carousel and in pillar rails.
// The library link goes to the internal detail page (/models/:slug); the
// external assessment app lives behind the "Launch" CTA on that page.
export async function upsertCollateralFromModel(model: Model): Promise<void> {
  const sourceId = modelSourceId(model.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const now = new Date();
  const withinWindow =
    (!model.publishedAt || model.publishedAt <= now) &&
    (!model.unpublishedAt || model.unpublishedAt > now);
  const isPublished =
    model.status === "published" &&
    model.active &&
    !model.deletedAt &&
    withinWindow;
  const normalizedPillar = normalizePillar(model.pillar);
  const serviceId = model.serviceId ?? (await pillarToServiceId(normalizedPillar));

  const syncedFields = {
    type: "model" as const,
    title: model.title,
    subtitle: null,
    description: model.shortDescription,
    heroImage: model.heroImage,
    pillar: normalizedPillar,
    tags: [] as string[],
    url: canonicalUrlForCollateral("model", model.slug),
    external: false,
    publishedAt: model.publishedAt,
    featured: model.featured,
    featuredRank: model.featuredRank,
    serviceId,
    solutionId: model.solutionId,
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

  const slug = await ensureUniqueCollateralSlug(model.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForModel(modelId: string): Promise<void> {
  const sourceId = modelSourceId(modelId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}

// Workshops appear in the library as collateral type="workshop" so they can
// be discovered alongside other content and filtered by service/solution.
export async function upsertCollateralFromWorkshop(
  workshop: Workshop,
): Promise<void> {
  const sourceId = workshopSourceId(workshop.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const isActive = workshop.active && !workshop.deletedAt;
  const now = new Date();

  const syncedFields = {
    type: "workshop" as const,
    title: workshop.title,
    subtitle: workshop.category || null,
    description: workshop.shortDescription ?? "",
    heroImage: workshop.heroImage ?? "",
    tags: [] as string[],
    url: canonicalUrlForCollateral("workshop", workshop.slug),
    external: false,
    publishedAt: null,
    featured: false,
    featuredRank: null,
    serviceId: workshop.serviceId,
    solutionId: workshop.solutionId,
    active: isActive,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(collateralTable)
      .set({
        ...syncedFields,
        deletedAt: isActive ? null : existing.deletedAt,
      })
      .where(eq(collateralTable.id, existing.id));
    return;
  }

  const slug = await ensureUniqueCollateralSlug(workshop.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForWorkshop(
  workshopId: string,
): Promise<void> {
  const sourceId = workshopSourceId(workshopId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}

// Landing pages opt into the library via the `featured` flag, mirroring
// the post→collateral sync. An unfeatured / unpublished / archived /
// soft-deleted page drops out of the library without losing its row, so
// flipping `featured` back on restores it cleanly.
export async function upsertCollateralFromLandingPage(
  page: LandingPage,
): Promise<void> {
  const sourceId = landingPageSourceId(page.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, sourceId),
  });

  const now = new Date();
  const withinWindow =
    (!page.publishedAt || page.publishedAt <= now) &&
    (!page.unpublishedAt || page.unpublishedAt > now);
  const isEligible =
    page.featured &&
    page.active &&
    page.status === "published" &&
    !page.deletedAt &&
    withinWindow;

  if (!isEligible) {
    if (existing) {
      await softDeleteCollateralForLandingPage(page.id);
    }
    return;
  }

  const normalizedPillar = normalizePillar(page.pillar);
  const serviceId =
    page.serviceId ?? (await pillarToServiceId(normalizedPillar));

  const syncedFields = {
    type: "landing_page" as const,
    title: page.title,
    subtitle: page.subtitle ?? null,
    description: page.description ?? "",
    heroImage: page.heroImage ?? "",
    pillar: normalizedPillar,
    tags: (page.tags as string[]) ?? [],
    url: canonicalUrlForCollateral("landing_page", page.slug),
    external: false,
    publishedAt: page.publishedAt,
    featured: page.featured,
    featuredRank: page.featuredRank,
    serviceId,
    solutionId: page.solutionId,
    active: true,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(collateralTable)
      .set({ ...syncedFields, deletedAt: null })
      .where(eq(collateralTable.id, existing.id));
    return;
  }

  const slug = await ensureUniqueCollateralSlug(page.slug);
  await db.insert(collateralTable).values({
    ...syncedFields,
    slug,
    sourceId,
  });
}

export async function softDeleteCollateralForLandingPage(
  landingPageId: string,
): Promise<void> {
  const sourceId = landingPageSourceId(landingPageId);
  const now = new Date();
  await db
    .update(collateralTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(collateralTable.sourceId, sourceId));
}
