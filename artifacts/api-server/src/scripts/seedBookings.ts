/**
 * Seed the default booking rows.
 *
 * Idempotent: only inserts rows when a booking with the same slug is missing.
 * Safe to run after `pnpm --filter @workspace/db push` to provision the table.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedBookings.ts
 */
import { eq } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";

const SEEDS = [
  {
    slug: "general",
    title: "Talk to a partner",
    teaser:
      "A 30-minute working session with a Synozur partner. Bring a problem statement; we'll bring questions and a recommendation.",
    embedUrl:
      "https://outlook.office365.com/owa/calendar/NorthStarWorkshopPlanning@synozur.com/bookings/",
    scope: "general" as const,
    displayOrder: 0,
  },
  {
    slug: "m365-strategy-adoption-workshop",
    title: "M365 Strategy & Adoption Workshop",
    teaser:
      "A focused working session with a Synozur Microsoft 365 specialist. We'll assess your current adoption posture, surface your highest-priority gaps, and outline a practical path forward.",
    embedUrl:
      "https://outlook.office365.com/owa/calendar/NorthStarWorkshopPlanning@synozur.com/bookings/",
    scope: "offer" as const,
    displayOrder: 10,
  },
];

async function main() {
  for (const SEED of SEEDS) {
    const existing = await db.query.bookingsTable.findFirst({
      where: eq(bookingsTable.slug, SEED.slug),
    });
    if (existing) {
      console.log(`Booking "${SEED.slug}" already exists — skipping.`);
      continue;
    }
    await db.insert(bookingsTable).values(SEED);
    console.log(`Booking "${SEED.slug}" created.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
