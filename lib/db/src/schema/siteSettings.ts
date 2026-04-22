import { pgTable, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";

export const siteSettingsTable = pgTable("site_settings", {
  id: integer("id").primaryKey().default(1),
  requireCookieConsent: boolean("require_cookie_consent").notNull().default(false),
  homeHeroImageAssetId: integer("home_hero_image_asset_id"),
  homeEditorialImageAssetId: integer("home_editorial_image_asset_id"),
  // Libsyn RSS feed URL for the Polaris podcast. Admin-configurable source for
  // the "Import from Libsyn" flow on the Polaris episodes admin page.
  polarisFeedUrl: text("polaris_feed_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
