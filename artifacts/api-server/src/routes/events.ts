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
  eventSpeakersTable,
  eventSessionsTable,
  teamMembersTable,
  type Event,
  type Asset,
  type Media,
  type Video,
  type EventSession,
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
  GetEventScheduleParams,
  GetEventScheduleResponse,
  ReplaceEventSessionsParams,
  ReplaceEventSessionsBody,
  ReplaceEventSessionsResponse,
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
  speakers: EventSpeakerRow[];
  hasSessions: boolean;
}

interface EventSpeakerRow {
  teamMemberId: number;
  name: string;
  slug: string;
  jobTitle: string;
  imageUrl: string | null;
  sortOrder: number;
}

async function loadSpeakersForEvents(
  eventIds: number[],
): Promise<Map<number, EventSpeakerRow[]>> {
  const out = new Map<number, EventSpeakerRow[]>();
  if (eventIds.length === 0) return out;
  const rows = await db
    .select({
      eventId: eventSpeakersTable.eventId,
      teamMemberId: teamMembersTable.id,
      name: teamMembersTable.name,
      slug: teamMembersTable.slug,
      jobTitle: teamMembersTable.jobTitle,
      imageUrl: teamMembersTable.imageUrl,
      active: teamMembersTable.active,
      sortOrder: eventSpeakersTable.sortOrder,
    })
    .from(eventSpeakersTable)
    .innerJoin(
      teamMembersTable,
      eq(teamMembersTable.id, eventSpeakersTable.teamMemberId),
    )
    .where(inArray(eventSpeakersTable.eventId, eventIds));
  for (const r of rows) {
    if (!r.active) continue;
    const list = out.get(r.eventId) ?? [];
    list.push({
      teamMemberId: r.teamMemberId,
      name: r.name,
      slug: r.slug,
      jobTitle: r.jobTitle,
      imageUrl: r.imageUrl ?? null,
      sortOrder: r.sortOrder,
    });
    out.set(r.eventId, list);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
  }
  return out;
}

async function replaceEventSpeakers(
  eventId: number,
  speakerIds: number[],
): Promise<void> {
  const deduped: number[] = [];
  const seen = new Set<number>();
  for (const id of speakerIds) {
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }
  // Validate team-member ids before the transaction so a bad input
  // doesn't open a transaction that then has to roll back.
  let values: { eventId: number; teamMemberId: number; sortOrder: number }[] = [];
  if (deduped.length > 0) {
    const validRows = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(inArray(teamMembersTable.id, deduped));
    const validIds = new Set(validRows.map((r) => r.id));
    values = deduped
      .filter((id) => validIds.has(id))
      .map((teamMemberId, idx) => ({ eventId, teamMemberId, sortOrder: idx }));
  }
  // Delete + insert in one transaction so a failed insert can't leave
  // the event with no speakers when the editor only meant to reorder.
  await db.transaction(async (tx) => {
    await tx
      .delete(eventSpeakersTable)
      .where(eq(eventSpeakersTable.eventId, eventId));
    if (values.length > 0) {
      await tx.insert(eventSpeakersTable).values(values);
    }
  });
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
  // Fan out the four lookups; they're independent.
  const [assetRows, mediaRows, videoRows, speakerMap] = await Promise.all([
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
    loadSpeakersForEvents([event.id]),
  ]);
  const [asset] = assetRows;
  const [media] = mediaRows;
  const [video] = videoRows;
  const assetsById = new Map(asset ? [[asset.id, asset]] : []);
  const mediaById = new Map(media ? [[media.id, media]] : []);
  const sessionCountRows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(eventSessionsTable)
    .where(eq(eventSessionsTable.eventId, event.id));
  return {
    event,
    imageUrl: resolveEventImageUrl(event, mediaById, assetsById),
    recordingVideo: video ?? null,
    speakers: speakerMap.get(event.id) ?? [],
    hasSessions: Number(sessionCountRows[0]?.cnt ?? 0) > 0,
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
  // The four lookups are independent — fan them out so endpoint latency
  // is bound by the slowest query rather than their sum.
  const [assets, mediaRows, videos, speakerMap] = await Promise.all([
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
    loadSpeakersForEvents(events.map((e) => e.id)),
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
    speakers: speakerMap.get(event.id) ?? [],
    hasSessions: false, // not needed on the list page; only populated by loadEventEnriched
  }));
}

function sessionShape(s: EventSession) {
  return {
    id: s.id,
    eventId: s.eventId,
    title: s.title,
    sessionType: s.sessionType ?? null,
    speakers: s.speakers ?? null,
    track: s.track ?? null,
    room: s.room ?? null,
    startTime: s.startTime ? new Date(s.startTime).toISOString() : null,
    sessionUrl: s.sessionUrl ?? null,
    sortOrder: s.sortOrder,
  };
}

// ── ICS helpers ──────────────────────────────────────────────────────────────

function icspad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a real UTC Date as local wall-clock time for DTSTART;TZID=... form. */
function icsLocalTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const g = (t: Intl.DateTimeFormatPartTypes) => {
    const v = parts.find((p) => p.type === t)?.value ?? "00";
    return v === "24" ? "00" : v;
  };
  return `${g("year")}${g("month")}${g("day")}T${g("hour")}${g("minute")}${g("second")}`;
}

/** Format a Date as UTC for DTSTART:...Z form. */
function icsUtcTime(date: Date): string {
  return (
    `${date.getUTCFullYear()}${icspad(date.getUTCMonth() + 1)}${icspad(date.getUTCDate())}` +
    `T${icspad(date.getUTCHours())}${icspad(date.getUTCMinutes())}${icspad(date.getUTCSeconds())}Z`
  );
}

/**
 * Session startTime values are stored as naive local-time timestamps
 * (the DB column is `timestamp`, not `timestamptz`). Extract the wall-clock
 * digits via UTC getters — they are the correct local-time digits.
 */
function icsNaiveLocalDigits(date: Date): string {
  return (
    `${date.getUTCFullYear()}${icspad(date.getUTCMonth() + 1)}${icspad(date.getUTCDate())}` +
    `T${icspad(date.getUTCHours())}${icspad(date.getUTCMinutes())}${icspad(date.getUTCSeconds())}`
  );
}

function foldIcsLine(line: string): string {
  const out: string[] = [];
  while (line.length > 75) {
    out.push(line.slice(0, 75));
    line = " " + line.slice(75);
  }
  out.push(line);
  return out.join("\r\n");
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// ── Shape helpers ─────────────────────────────────────────────────────────────

function publicShape(enriched: EnrichedEvent) {
  const { event, imageUrl, recordingVideo, speakers, hasSessions } = enriched;
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
    speakers,
    hasSessions,
    timezone: event.timezone ?? null,
  };
}

function adminShape(enriched: EnrichedEvent) {
  const { event, imageUrl, recordingVideo, speakers } = enriched;
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
    speakers,
    timezone: event.timezone ?? null,
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
      timezone: parsed.data.timezone ?? null,
    })
    .returning();
  if (parsed.data.speakerIds !== undefined) {
    await replaceEventSpeakers(event.id, parsed.data.speakerIds);
  }
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
      timezone: parsed.data.timezone ?? null,
    })
    .where(eq(eventsTable.id, params.data.id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (parsed.data.speakerIds !== undefined) {
    await replaceEventSpeakers(event.id, parsed.data.speakerIds);
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

// Public schedule for an event
router.get("/events/:slug/schedule", async (req, res): Promise<void> => {
  const params = GetEventScheduleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(eq(eventsTable.slug, params.data.slug));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const sessions = await db
    .select()
    .from(eventSessionsTable)
    .where(eq(eventSessionsTable.eventId, event.id))
    .orderBy(asc(eventSessionsTable.sortOrder), asc(eventSessionsTable.startTime));
  res.json(GetEventScheduleResponse.parse({ items: sessions.map(sessionShape) }));
});

// ICS calendar download for an event
router.get("/events/:slug/calendar.ics", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  const [event] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.slug, slug));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const sessions = await db
    .select()
    .from(eventSessionsTable)
    .where(eq(eventSessionsTable.eventId, event.id))
    .orderBy(asc(eventSessionsTable.sortOrder), asc(eventSessionsTable.startTime));

  const tz = event.timezone ?? null;
  const now = new Date();
  const lines: string[] = [];
  const add = (line: string) => lines.push(foldIcsLine(line));

  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Synozur Alliance//Events//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  if (tz) add(`X-WR-TIMEZONE:${tz}`);
  add(`X-WR-CALNAME:${escapeIcs(event.title)}`);

  // Main event VEVENT (start + 1 day as end when no explicit end time)
  const startDate = new Date(event.startDate);
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
  lines.push("BEGIN:VEVENT");
  add(`UID:${event.slug}@synozur.com`);
  if (tz) {
    add(`DTSTART;TZID=${tz}:${icsLocalTime(startDate, tz)}`);
    add(`DTEND;TZID=${tz}:${icsLocalTime(endDate, tz)}`);
  } else {
    add(`DTSTART:${icsUtcTime(startDate)}`);
    add(`DTEND:${icsUtcTime(endDate)}`);
  }
  add(`SUMMARY:${escapeIcs(event.title)}`);
  if (event.location) add(`LOCATION:${escapeIcs(event.location)}`);
  if (event.teaser || event.description) {
    add(`DESCRIPTION:${escapeIcs(event.teaser ?? event.description ?? "")}`);
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const eventUrl = domain
    ? `https://${domain}/events/${event.slug}`
    : `/events/${event.slug}`;
  add(`URL:${eventUrl}`);
  add(`DTSTAMP:${icsUtcTime(now)}`);
  lines.push("END:VEVENT");

  // One VEVENT per session
  for (const session of sessions) {
    if (!session.startTime) continue;
    const st = new Date(session.startTime as unknown as string);
    // Session end: 1 hour after start (no duration stored)
    const et = new Date(st.getTime() + 60 * 60 * 1000);
    lines.push("BEGIN:VEVENT");
    add(`UID:${event.slug}-session-${session.id}@synozur.com`);
    if (tz) {
      // startTime is stored as naive local — UTC digits = local time digits
      add(`DTSTART;TZID=${tz}:${icsNaiveLocalDigits(st)}`);
      add(`DTEND;TZID=${tz}:${icsNaiveLocalDigits(et)}`);
    } else {
      add(`DTSTART:${icsNaiveLocalDigits(st)}Z`);
      add(`DTEND:${icsNaiveLocalDigits(et)}Z`);
    }
    add(`SUMMARY:${escapeIcs(session.title)}`);
    if (session.room) add(`LOCATION:${escapeIcs(session.room)}`);
    const descParts: string[] = [];
    if (session.speakers) descParts.push(`Speakers: ${session.speakers}`);
    if (session.track) descParts.push(`Track: ${session.track}`);
    if (session.sessionUrl) descParts.push(`Details: ${session.sessionUrl}`);
    if (descParts.length > 0) {
      add(`DESCRIPTION:${escapeIcs(descParts.join("\n"))}`);
    }
    add(`DTSTAMP:${icsUtcTime(now)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  const icsContent = lines.join("\r\n") + "\r\n";
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${event.slug}.ics"`,
  );
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.send(icsContent);
});

// Replace all sessions for an event (admin)
router.put("/admin/events/:id/sessions", requireAdmin, async (req, res): Promise<void> => {
  const params = ReplaceEventSessionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ReplaceEventSessionsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  await db.delete(eventSessionsTable).where(eq(eventSessionsTable.eventId, event.id));
  const toInsert = body.data.sessions.map((s, idx) => ({
    eventId: event.id,
    title: s.title,
    sessionType: s.sessionType ?? null,
    speakers: s.speakers ?? null,
    track: s.track ?? null,
    room: s.room ?? null,
    startTime: s.startTime ? new Date(s.startTime) : null,
    sessionUrl: s.sessionUrl ?? null,
    sortOrder: s.sortOrder ?? idx,
  }));
  const inserted =
    toInsert.length > 0
      ? await db.insert(eventSessionsTable).values(toInsert).returning()
      : [];
  await audit({
    actorId: req.authedUser?.id,
    action: "event.sessions.replace",
    entity: "event",
    entityId: String(event.id),
    diff: { sessionCount: inserted.length },
  });
  res.json(ReplaceEventSessionsResponse.parse({ items: inserted.map(sessionShape) }));
});

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
