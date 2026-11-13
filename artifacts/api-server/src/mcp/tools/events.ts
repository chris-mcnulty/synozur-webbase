import { z } from "zod";
import { asc, desc, eq, inArray, lt, gte } from "drizzle-orm";
import { db, eventsTable, eventSessionsTable, eventSpeakersTable, teamMembersTable, mediaTable } from "@workspace/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function serializeEvent(event: typeof eventsTable.$inferSelect, imageUrl: string | null) {
  return {
    id: event.id,
    slug: event.slug,
    // `name` alias lets Orbit (and other callers) use either field.
    name: event.title,
    title: event.title,
    teaser: event.teaser ?? null,
    description: event.description ?? event.teaser ?? null,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    location: event.location ?? null,
    timezone: event.timezone ?? null,
    eventType: event.eventType,
    registrationStatus: event.registrationStatus,
    // `url` = registration URL when set, otherwise the public event page.
    url: event.registrationUrl ?? `/events/${event.slug}`,
    registrationUrl: event.registrationUrl ?? null,
    status: event.status,
    featured: event.featured,
    imageUrl,
    createdAt: event.createdAt.toISOString(),
  };
}

export function registerEventTools(server: McpServer) {
  server.tool(
    "list_events",
    "List events, optionally filtered to upcoming only. Accepts Orbit-style {upcoming, limit} and legacy pagination-style {page, pageSize} parameters. Orbit-style calls return a flat array; paginated calls return {items, page, pageSize}.",
    {
      upcoming: z.boolean().optional().default(true).describe("When true (default), only return events with startDate >= today"),
      limit: z.number().int().min(1).max(200).optional().describe("Max number of events to return (Orbit-style)"),
      page: z.number().int().min(1).optional().describe("Legacy pagination page; providing this returns a paginated response"),
      pageSize: z.number().int().min(1).max(50).optional().describe("Legacy pagination size"),
    },
    async ({ upcoming, limit, page: requestedPage, pageSize: requestedPageSize }) => {
      const now = new Date();
      const page = requestedPage ?? 1;
      const pageSize = requestedPageSize ?? 12;
      const orbitStyle = requestedPage === undefined && requestedPageSize === undefined;
      const effectiveLimit = limit ?? (orbitStyle ? 50 : pageSize);
      const offset = orbitStyle ? 0 : (page - 1) * pageSize;

      const events = await db
        .select()
        .from(eventsTable)
        .where(upcoming ? gte(eventsTable.startDate, now) : undefined)
        .orderBy(asc(eventsTable.startDate))
        .limit(effectiveLimit)
        .offset(offset);

      const mediaIds = events.map((e) => e.imageMediaId).filter((id): id is string => Boolean(id));
      const media = mediaIds.length
        ? await db.select({ id: mediaTable.id, publicUrl: mediaTable.publicUrl }).from(mediaTable).where(inArray(mediaTable.id, mediaIds))
        : [];
      const mediaMap = new Map(media.map((m) => [m.id, m.publicUrl]));

      const items = events.map((e) => serializeEvent(e, e.imageMediaId ? (mediaMap.get(e.imageMediaId) ?? null) : null));
      const payload = orbitStyle ? items : { items, page, pageSize: effectiveLimit };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );

  server.tool(
    "list_past_events",
    "List past events (startDate before now), most recent first. Useful for retrospectives and archive promotion.",
    {
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(12),
    },
    async ({ page, pageSize }) => {
      const now = new Date();
      const offset = (page - 1) * pageSize;

      const events = await db
        .select()
        .from(eventsTable)
        .where(lt(eventsTable.startDate, now))
        .orderBy(desc(eventsTable.startDate))
        .limit(pageSize)
        .offset(offset);

      const mediaIds = events.map((e) => e.imageMediaId).filter((id): id is string => Boolean(id));
      const media = mediaIds.length
        ? await db.select({ id: mediaTable.id, publicUrl: mediaTable.publicUrl }).from(mediaTable).where(inArray(mediaTable.id, mediaIds))
        : [];
      const mediaMap = new Map(media.map((m) => [m.id, m.publicUrl]));

      const items = events.map((e) => serializeEvent(e, e.imageMediaId ? (mediaMap.get(e.imageMediaId) ?? null) : null));
      return { content: [{ type: "text" as const, text: JSON.stringify({ items, page, pageSize }) }] };
    },
  );

  server.tool(
    "get_event",
    "Get full details for an event by slug, including the session schedule and speaker roster.",
    {
      slug: z.string().describe("Event slug"),
    },
    async ({ slug }) => {
      const [event] = await db.select().from(eventsTable).where(eq(eventsTable.slug, slug));
      if (!event) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Event not found" }) }], isError: true };
      }

      const [sessions, speakerRows, mediaRow] = await Promise.all([
        db.select().from(eventSessionsTable).where(eq(eventSessionsTable.eventId, event.id)).orderBy(asc(eventSessionsTable.sortOrder)),
        db
          .select({
            sortOrder: eventSpeakersTable.sortOrder,
            name: teamMembersTable.name,
            title: teamMembersTable.jobTitle,
            shortDescription: teamMembersTable.shortDescription,
            imageUrl: teamMembersTable.imageUrl,
            slug: teamMembersTable.slug,
            linkedinUrl: teamMembersTable.linkedinUrl,
          })
          .from(eventSpeakersTable)
          .innerJoin(teamMembersTable, eq(eventSpeakersTable.teamMemberId, teamMembersTable.id))
          .where(eq(eventSpeakersTable.eventId, event.id))
          .orderBy(asc(eventSpeakersTable.sortOrder)),
        event.imageMediaId
          ? db.select({ publicUrl: mediaTable.publicUrl }).from(mediaTable).where(eq(mediaTable.id, event.imageMediaId))
          : Promise.resolve([]),
      ]);

      const imageUrl = mediaRow[0]?.publicUrl ?? null;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...serializeEvent(event, imageUrl),
            description: event.description ?? null,
            sessions: sessions.map((s) => ({
              id: s.id,
              title: s.title,
              sessionType: s.sessionType ?? null,
              speakers: s.speakers ?? null,
              track: s.track ?? null,
              room: s.room ?? null,
              startTime: s.startTime?.toISOString() ?? null,
              sessionUrl: s.sessionUrl ?? null,
            })),
            speakers: speakerRows,
          }),
        }],
      };
    },
  );
}
