import { eq } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";

export type LinkedBookingDto = {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
  msBusinessId: string | null;
  msDefaultServiceId: string | null;
};

function serializeLinkedBooking(row: typeof bookingsTable.$inferSelect): LinkedBookingDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    teaser: row.teaser ?? null,
    scope: row.scope,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    msBusinessId: row.msBusinessId ?? null,
    msDefaultServiceId: row.msDefaultServiceId ?? null,
  };
}

export async function loadLinkedBooking(id: string | null): Promise<LinkedBookingDto | null> {
  if (!id) return null;
  const row = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, id),
  });
  if (!row || !row.active) return null;
  const now = new Date();
  if (row.startsAt && row.startsAt > now) return null;
  if (row.endsAt && row.endsAt <= now) return null;
  return serializeLinkedBooking(row);
}
