import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Microsoft Bookings embed entries shown on /start. Each row corresponds to
// a single Booking calendar (e.g. NorthStarWorkshopPlanning). Scopes:
//   - "general"    : always-on, surfaced first.
//   - "offer"      : tied to a specific offer; usually time-bound.
//   - "conference" : tied to a conference window.
// startsAt / endsAt are optional; when present they gate public visibility.
export const bookingsTable = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    teaser: text("teaser"),
    descriptionHtml: text("description_html"),
    embedUrl: text("embed_url").notNull(),
    scope: text("scope").notNull().default("general"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("bookings_slug_key").on(t.slug)],
);

export type Booking = typeof bookingsTable.$inferSelect;
export type InsertBooking = typeof bookingsTable.$inferInsert;
