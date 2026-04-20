import { and, eq, ne } from "drizzle-orm";
import { db, collateralTable, type Event } from "@workspace/db";
import { toSlug } from "./slug";

const EVENT_SOURCE_PREFIX = "event:";

export function eventSourceId(eventId: number): string {
  return `${EVENT_SOURCE_PREFIX}${eventId}`;
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
    subtitle: event.location ?? null,
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
