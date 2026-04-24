import { Router, type IRouter } from "express";
import { eq, asc, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  db,
  eventsTable,
  assetsTable,
  videosTable,
  type Event,
  type Asset,
  type Video,
} from "@workspace/db";
import {
  ListPublicEventsResponse,
  ListPublicEventsResponseItem,
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
import {
  upsertCollateralFromEvent,
  softDeleteCollateralForEvent,
} from "../lib/syncCollateral";
import { seedEventsFromCsv } from "../scripts/seedEvents";

const router: IRouter = Router();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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

interface EnrichedEvent {
  event: Event;
  imageUrl: string | null;
  recordingVideo: Pick<Video, "id" | "slug" | "title" | "videoUrl"> | null;
}

async function loadEventEnriched(event: Event): Promise<EnrichedEvent> {
  const [asset] = event.imageAssetId
    ? await db
        .select()
        .from(assetsTable)
        .where(eq(assetsTable.id, event.imageAssetId))
    : [];
  const [video] = event.recordingVideoId
    ? await db
        .select({
          id: videosTable.id,
          slug: videosTable.slug,
          title: videosTable.title,
          videoUrl: videosTable.videoUrl,
        })
        .from(videosTable)
        .where(eq(videosTable.id, event.recordingVideoId))
    : [];
  return {
    event,
    imageUrl: imageUrlFor(asset),
    recordingVideo: video ?? null,
  };
}

async function loadEventsEnriched(events: Event[]): Promise<EnrichedEvent[]> {
  const assetIds = Array.from(
    new Set(events.map((e) => e.imageAssetId).filter((v): v is number => v != null)),
  );
  const videoIds = Array.from(
    new Set(events.map((e) => e.recordingVideoId).filter((v): v is string => v != null)),
  );
  const assets = assetIds.length
    ? await db.select().from(assetsTable).where(inArray(assetsTable.id, assetIds))
    : [];
  const videos = videoIds.length
    ? await db
        .select({
          id: videosTable.id,
          slug: videosTable.slug,
          title: videosTable.title,
          videoUrl: videosTable.videoUrl,
        })
        .from(videosTable)
        .where(inArray(videosTable.id, videoIds))
    : [];
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const videosById = new Map(videos.map((v) => [v.id, v]));
  return events.map((event) => ({
    event,
    imageUrl: imageUrlFor(event.imageAssetId ? assetsById.get(event.imageAssetId) : null),
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
      recordingVideoId: parsed.data.recordingVideoId ?? null,
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
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.title);
  const slug = await ensureUniqueSlug(slugBase, params.data.id);
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
      recordingVideoId: parsed.data.recordingVideoId ?? null,
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
