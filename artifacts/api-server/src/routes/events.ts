import { Router, type IRouter } from "express";
import { eq, asc, inArray, and, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  db,
  eventsTable,
  assetsTable,
  mediaTable,
  videosTable,
  type Event,
  type Asset,
  type Media,
  type Video,
} from "@workspace/db";
import {
  ListPublicEventsResponse,
  ListAdminEventsResponse,
  ListAdminEventsResponseItem,
  GetAdminEventResponse,
  CreateEventBody,
  UpdateEventBody,
  GetAdminEventParams,
  UpdateEventParams,
  DeleteEventParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { sendGone } from "../lib/goneResponse";
import { audit, buildAuditDiff } from "../lib/audit";
import {
  upsertCollateralFromEvent,
  softDeleteCollateralForEvent,
} from "../lib/syncCollateral";
import { seedEventsFromCsv } from "../scripts/seedEvents";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Verify a media UUID exists and points at an image. Returns an error
// message string when the reference is invalid, null when it passes. We
// validate up front so an unknown UUID surfaces as a 400 with a clear
// message instead of an opaque 500 from the FK constraint.
async function validateImageMediaId(
  imageMediaId: string | null | undefined,
): Promise<string | null> {
  if (!imageMediaId) return null;
  if (!isValidUuid(imageMediaId)) return "imageMediaId must be a valid UUID";
  const [row] = await db
    .select({ mime: mediaTable.mime })
    .from(mediaTable)
    .where(eq(mediaTable.id, imageMediaId));
  if (!row) return "imageMediaId references a non-existent media row";
  if (row.mime && !row.mime.startsWith("image/")) {
    return `Media MIME type '${row.mime}' is not an image`;
  }
  return null;
}

async function ensureUniqueSlug(base: string, ignoreId?: number): Promise<string> {
  const seed = base || `event-${Date.now()}`;
  let candidate = seed;
  let i = 2;
  for (let attempt = 0; attempt < 100; attempt++) {
    const existing = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.slug, candidate));
    const conflict = existing.find((e) => e.id !== ignoreId);
    if (!conflict) return candidate;
    candidate = `${seed}-${i++}`;
  }
  return `${seed}-${Date.now()}`;
}

function imageUrlFor(asset: Asset | undefined | null): string | null {
  if (!asset) return null;
  return `/api/storage${asset.storageKey}`;
}

function mediaUrlFor(media: Media | undefined | null): string | null {
  if (!media) return null;
  return media.publicUrl || `/api/storage${media.storageKey}`;
}

interface EnrichedEvent {
  event: Event;
  imageUrl: string | null;
  recordingVideo: Pick<Video, "id" | "slug" | "title" | "videoUrl"> | null;
}

// Resolve the event hero image URL. New writes from the editor populate
// `imageMediaId` (UUID, FK to `media`); legacy rows still carry only the
// integer `imageAssetId`. Prefer the media-backed URL when present.
function resolveEventImageUrl(
  event: Event,
  mediaById: Map<string, Media>,
  assetsById: Map<number, Asset>,
): string | null {
  if (event.imageMediaId) {
    const m = mediaById.get(event.imageMediaId);
    if (m) return mediaUrlFor(m);
  }
  if (event.imageAssetId) {
    return imageUrlFor(assetsById.get(event.imageAssetId) ?? null);
  }
  return null;
}

async function loadEventEnriched(event: Event): Promise<EnrichedEvent> {
  const now = new Date();
  // Fan out the three lookups; they're independent.
  const [assetRows, mediaRows, videoRows] = await Promise.all([
    event.imageAssetId
      ? db
          .select()
          .from(assetsTable)
          .where(eq(assetsTable.id, event.imageAssetId))
      : Promise.resolve([]),
    event.imageMediaId
      ? db
          .select()
          .from(mediaTable)
          .where(eq(mediaTable.id, event.imageMediaId))
      : Promise.resolve([]),
    event.recordingVideoId
      ? db
          .select({
            id: videosTable.id,
            slug: videosTable.slug,
            title: videosTable.title,
            videoUrl: videosTable.videoUrl,
          })
          .from(videosTable)
          .where(
            and(
              eq(videosTable.id, event.recordingVideoId),
              eq(videosTable.active, true),
              eq(videosTable.status, "published"),
              sql`${videosTable.deletedAt} is null`,
              sql`${videosTable.publishedAt} <= ${now}`,
              sql`(${videosTable.unpublishedAt} is null or ${videosTable.unpublishedAt} > ${now})`,
            ),
          )
      : Promise.resolve([]),
  ]);
  const [asset] = assetRows;
  const [media] = mediaRows;
  const [video] = videoRows;
  const assetsById = new Map(asset ? [[asset.id, asset]] : []);
  const mediaById = new Map(media ? [[media.id, media]] : []);
  return {
    event,
    imageUrl: resolveEventImageUrl(event, mediaById, assetsById),
    recordingVideo: video ?? null,
  };
}

async function loadEventsEnriched(events: Event[]): Promise<EnrichedEvent[]> {
  const assetIds = Array.from(
    new Set(events.map((e) => e.imageAssetId).filter((v): v is number => v != null)),
  );
  const mediaIds = Array.from(
    new Set(events.map((e) => e.imageMediaId).filter((v): v is string => v != null)),
  );
  const videoIds = Array.from(
    new Set(events.map((e) => e.recordingVideoId).filter((v): v is string => v != null)),
  );
  const now = new Date();
  // The three lookups are independent — fan them out so endpoint latency
  // is bound by the slowest query rather than their sum.
  const [assets, mediaRows, videos] = await Promise.all([
    assetIds.length
      ? db.select().from(assetsTable).where(inArray(assetsTable.id, assetIds))
      : Promise.resolve([]),
    mediaIds.length
      ? db.select().from(mediaTable).where(inArray(mediaTable.id, mediaIds))
      : Promise.resolve([]),
    videoIds.length
      ? db
          .select({
            id: videosTable.id,
            slug: videosTable.slug,
            title: videosTable.title,
            videoUrl: videosTable.videoUrl,
          })
          .from(videosTable)
          .where(
            and(
              inArray(videosTable.id, videoIds),
              eq(videosTable.active, true),
              eq(videosTable.status, "published"),
              sql`${videosTable.deletedAt} is null`,
              sql`${videosTable.publishedAt} <= ${now}`,
              sql`(${videosTable.unpublishedAt} is null or ${videosTable.unpublishedAt} > ${now})`,
            ),
          )
      : Promise.resolve([]),
  ]);
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));
  const videosById = new Map(videos.map((v) => [v.id, v]));
  return events.map((event) => ({
    event,
    imageUrl: resolveEventImageUrl(event, mediaById, assetsById),
    recordingVideo: event.recordingVideoId
      ? videosById.get(event.recordingVideoId) ?? null
      : null,
  }));
}

function publicShape(enriched: EnrichedEvent) {
  const { event, imageUrl, recordingVideo } = enriched;
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    startDate: event.startDate,
    location: event.location,
    teaser: event.teaser,
    description: event.description,
    registrationUrl: event.registrationUrl,
    registrationStatus: event.registrationStatus,
    eventType: event.eventType,
    status: event.status,
    imageUrl,
    recordingVideoId: recordingVideo?.id ?? null,
    recordingVideoSlug: recordingVideo?.slug ?? null,
    recordingVideoUrl: recordingVideo?.videoUrl || null,
    recordingVideoTitle: recordingVideo?.title ?? null,
  };
}

function adminShape(enriched: EnrichedEvent) {
  const { event, imageUrl, recordingVideo } = enriched;
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    startDate: event.startDate,
    location: event.location,
    teaser: event.teaser,
    description: event.description,
    registrationUrl: event.registrationUrl,
    registrationStatus: event.registrationStatus,
    eventType: event.eventType,
    status: event.status,
    featured: event.featured,
    featuredRank: event.featuredRank,
    imageAssetId: event.imageAssetId,
    imageMediaId: event.imageMediaId,
    imageUrl,
    recordingVideoId: recordingVideo?.id ?? null,
    recordingVideoSlug: recordingVideo?.slug ?? null,
    recordingVideoTitle: recordingVideo?.title ?? null,
    recordingVideoUrl: recordingVideo?.videoUrl || null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

router.get("/events", async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(asc(eventsTable.startDate));
  const enriched = await loadEventsEnriched(rows);
  res.json(ListPublicEventsResponse.parse(enriched.map(publicShape)));
});

router.get("/events/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  const [event] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.slug, slug));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  // L13: events use a free-form text status (default "UPCOMING"). Editors
  // who set status to "ARCHIVED"/"archived" want the URL out of Google;
  // 410 is the right de-index signal there. Past events whose status is
  // still "PAST" or "UPCOMING" stay 200 — they have legitimate ongoing
  // recap value.
  if ((event.status ?? "").toLowerCase() === "archived") {
    sendGone(res, "event");
    return;
  }
  const enriched = await loadEventEnriched(event);
  res.json(publicShape(enriched));
});

router.get("/admin/events", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(asc(eventsTable.startDate));
  const enriched = await loadEventsEnriched(rows);
  res.json(ListAdminEventsResponse.parse(enriched.map(adminShape)));
});

router.get("/admin/events/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetAdminEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, params.data.id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const enriched = await loadEventEnriched(event);
  res.json(GetAdminEventResponse.parse(adminShape(enriched)));
});

router.post("/admin/events", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const recordingVideoId = parsed.data.recordingVideoId ?? null;
  if (recordingVideoId != null && !isValidUuid(recordingVideoId)) {
    res.status(400).json({ error: "recordingVideoId must be a valid UUID" });
    return;
  }
  const imageMediaError = await validateImageMediaId(parsed.data.imageMediaId);
  if (imageMediaError) {
    res.status(400).json({ error: imageMediaError });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.title);
  const slug = await ensureUniqueSlug(slugBase);
  const [event] = await db
    .insert(eventsTable)
    .values({
      title: parsed.data.title,
      slug,
      startDate: parsed.data.startDate,
      location: parsed.data.location ?? null,
      teaser: parsed.data.teaser ?? null,
      description: parsed.data.description ?? null,
      registrationUrl: parsed.data.registrationUrl ?? null,
      registrationStatus: parsed.data.registrationStatus ?? "UNKNOWN_REGISTRATION_STATUS",
      eventType: parsed.data.eventType ?? "RSVP",
      status: parsed.data.status ?? "UPCOMING",
      featured: parsed.data.featured ?? false,
      featuredRank: parsed.data.featuredRank ?? null,
      imageAssetId: parsed.data.imageAssetId ?? null,
      imageMediaId: parsed.data.imageMediaId ?? null,
      recordingVideoId,
    })
    .returning();
  const enriched = await loadEventEnriched(event);
  try {
    await upsertCollateralFromEvent(event, enriched.imageUrl);
  } catch (error) {
    console.error("Failed to sync collateral after event create", {
      eventId: event.id,
      error,
    });
  }
  await audit({
    actorId: req.authedUser?.id,
    action: "event.create",
    entity: "event",
    entityId: String(event.id),
    diff: { after: event },
  });
  res.status(201).json(ListAdminEventsResponseItem.parse(adminShape(enriched)));
});

router.patch("/admin/events/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const recordingVideoId = parsed.data.recordingVideoId ?? null;
  if (recordingVideoId != null && !isValidUuid(recordingVideoId)) {
    res.status(400).json({ error: "recordingVideoId must be a valid UUID" });
    return;
  }
  const imageMediaError = await validateImageMediaId(parsed.data.imageMediaId);
  if (imageMediaError) {
    res.status(400).json({ error: imageMediaError });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.title);
  const slug = await ensureUniqueSlug(slugBase, params.data.id);
  const [before] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.id));
  const [event] = await db
    .update(eventsTable)
    .set({
      title: parsed.data.title,
      slug,
      startDate: parsed.data.startDate,
      location: parsed.data.location ?? null,
      teaser: parsed.data.teaser ?? null,
      description: parsed.data.description ?? null,
      registrationUrl: parsed.data.registrationUrl ?? null,
      registrationStatus: parsed.data.registrationStatus ?? "UNKNOWN_REGISTRATION_STATUS",
      eventType: parsed.data.eventType ?? "RSVP",
      status: parsed.data.status ?? "UPCOMING",
      featured: parsed.data.featured ?? false,
      featuredRank: parsed.data.featuredRank ?? null,
      imageAssetId: parsed.data.imageAssetId ?? null,
      imageMediaId: parsed.data.imageMediaId ?? null,
      recordingVideoId,
    })
    .where(eq(eventsTable.id, params.data.id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const enriched = await loadEventEnriched(event);
  try {
    await upsertCollateralFromEvent(event, enriched.imageUrl);
  } catch (error) {
    console.error("Failed to sync collateral after event update", {
      eventId: event.id,
      error,
    });
  }
  await audit({
    actorId: req.authedUser?.id,
    action: "event.update",
    entity: "event",
    entityId: String(event.id),
    diff: before ? buildAuditDiff(before, event) : { after: event },
  });
  res.json(ListAdminEventsResponseItem.parse(adminShape(enriched)));
});

router.delete("/admin/events/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [event] = await db
    .delete(eventsTable)
    .where(eq(eventsTable.id, params.data.id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  try {
    await softDeleteCollateralForEvent(event.id);
  } catch (error) {
    console.error("Failed to soft-delete collateral after event delete", {
      eventId: event.id,
      error,
    });
  }
  await audit({
    actorId: req.authedUser?.id,
    action: "event.delete",
    entity: "event",
    entityId: String(event.id),
    diff: { before: event },
  });
  res.sendStatus(204);
});

router.post(
  "/admin/events/:id/sync-to-collateral",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = GetAdminEventParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, params.data.id));
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const enriched = await loadEventEnriched(event);
    await upsertCollateralFromEvent(event, enriched.imageUrl);
    res.json({ ok: true });
  },
);

router.post("/admin/seed-events", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const csvPath = resolve(
      process.cwd(),
      "../../attached_assets/events_1776704614264.csv",
    );
    const raw = readFileSync(csvPath, "utf8");
    const result = await seedEventsFromCsv(raw);
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
