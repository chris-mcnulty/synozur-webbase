/**
 * Seed the default "general" booking row used on /start.
 *
 * Idempotent: only inserts the seed row when a booking with the same slug
 * is missing. Safe to run after `pnpm --filter @workspace/db push` to
 * provision the table and bootstrap the always-on Bookings calendar.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedBookings.ts
 */
import { eq } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";

const SEED = {
  slug: "general",
  title: "Talk to a partner",
  teaser:
    "A 30-minute working session with a Synozur partner. Bring a problem statement; we'll bring questions and a recommendation.",
  embedUrl:
    "https://outlook.office365.com/owa/calendar/NorthStarWorkshopPlanning@synozur.com/bookings/",
  scope: "general" as const,
  displayOrder: 0,
};

async function main() {
  const existing = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.slug, SEED.slug),
  });
  if (existing) {
    console.log(`Booking "${SEED.slug}" already exists — skipping.`);
    return;
  }
  await db.insert(bookingsTable).values(SEED);
  console.log(`Booking "${SEED.slug}" created.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
