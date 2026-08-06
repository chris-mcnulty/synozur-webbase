import { z } from "zod";
import { asc, desc, eq, inArray, lt, gte } from "drizzle-orm";
import { db, eventsTable, eventSessionsTable, eventSpeakersTable, teamMembersTable, mediaTable } from "@workspace/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function serializeEvent(event: typeof eventsTable.$inferSelect, imageUrl: string | null) {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    teaser: event.teaser ?? null,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    location: event.location ?? null,
    timezone: event.timezone ?? null,
    eventType: event.eventType,
    registrationStatus: event.registrationStatus,
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
    `List events from the website calendar. Returns a flat array of { id, name, startDate, endDate, location, url, description }.
When upcoming is true (default) only events whose startDate is today or later are returned.
Use limit to cap the number of results (default 50, max 200).`,
    {
      upcoming: z.boolean().optional().default(true),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ upcoming, limit }) => {
      const now = new Date();

      const rows = upcoming
        ? await db
            .select()
            .from(eventsTable)
            .where(gte(eventsTable.startDate, now))
            .orderBy(asc(eventsTable.startDate))
            .limit(limit)
        : await db
            .select()
            .from(eventsTable)
            .orderBy(asc(eventsTable.startDate))
            .limit(limit);

      const items = rows.map((e) => ({
        id: e.id,
        name: e.title,
        startDate: e.startDate.toISOString(),
        endDate: e.endDate?.toISOString() ?? null,
        location: e.location ?? null,
        url: e.registrationUrl ?? null,
        description: (e as any).description ?? e.teaser ?? null,
      }));

      return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
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
            description: (event as any).description ?? null,
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
