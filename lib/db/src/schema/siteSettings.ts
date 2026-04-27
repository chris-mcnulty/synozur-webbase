import { pgTable, integer, boolean, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { mediaTable } from "./media";

// Parallel `*MediaId` UUID columns sit alongside the legacy `*AssetId`
// integer FKs. The asset-library migration (BACKLOG.md §1) populates the new
// columns from the editor while leaving the integer ones in place; route
// serializers prefer the media-backed URL when present and fall back to
// the legacy asset lookup so older rows keep rendering until backfilled.
export const siteSettingsTable = pgTable("site_settings", {
  id: integer("id").primaryKey().default(1),
  requireCookieConsent: boolean("require_cookie_consent").notNull().default(false),
  homeHeroImageAssetId: integer("home_hero_image_asset_id"),
  homeHeroImageMediaId: uuid("home_hero_image_media_id").references(
    () => mediaTable.id,
    { onDelete: "set null" },
  ),
  homeEditorialImageAssetId: integer("home_editorial_image_asset_id"),
  homeEditorialImageMediaId: uuid("home_editorial_image_media_id").references(
    () => mediaTable.id,
    { onDelete: "set null" },
  ),
  // Libsyn RSS feed URL for the Polaris podcast. Admin-configurable source for
  // the "Import from Libsyn" flow on the Polaris episodes admin page.
  polarisFeedUrl: text("polaris_feed_url"),

  // SEO defaults (null ⇒ use the hard-coded fallback in seo-config.ts / Meta)
  seoDefaultTitleTemplate: text("seo_default_title_template"),
  seoDefaultDescription: text("seo_default_description"),
  seoDefaultOgImageAssetId: integer("seo_default_og_image_asset_id"),
  seoDefaultOgImageMediaId: uuid("seo_default_og_image_media_id").references(
    () => mediaTable.id,
    { onDelete: "set null" },
  ),

  // Social
  seoTwitterHandle: text("seo_twitter_handle"),
  seoTwitterCardType: text("seo_twitter_card_type"),
  seoLinkedinCompanyUrl: text("seo_linkedin_company_url"),

  // Search-engine verification tokens
  seoGoogleSiteVerification: text("seo_google_site_verification"),
  seoBingSiteVerification: text("seo_bing_site_verification"),

  // Organization JSON-LD (null ⇒ use the hard-coded defaults in organization-jsonld.tsx)
  orgName: text("org_name"),
  orgLegalName: text("org_legal_name"),
  orgLogoAssetId: integer("org_logo_asset_id"),
  orgLogoMediaId: uuid("org_logo_media_id").references(() => mediaTable.id, {
    onDelete: "set null",
  }),
  orgStreetAddress: text("org_street_address"),
  orgAddressLocality: text("org_address_locality"),
  orgAddressRegion: text("org_address_region"),
  orgPostalCode: text("org_postal_code"),
  orgAddressCountry: text("org_address_country"),
  orgSameAs: jsonb("org_same_as").$type<string[]>(),

  // Marketing tag IDs (null ⇒ fall back to VITE_* env vars in analytics.tsx)
  tagGa4Id: text("tag_ga4_id"),
  tagLinkedinPartnerId: text("tag_linkedin_partner_id"),
  tagMetaPixelId: text("tag_meta_pixel_id"),

  // Sitemap controls
  sitemapExcludedPaths: jsonb("sitemap_excluded_paths").$type<string[]>(),
  sitemapSectionFlags: jsonb("sitemap_section_flags").$type<Record<string, boolean>>(),

  // #131: HubSpot integration. The access token + portal id stay in env;
  // these settings are the policy knobs admins tune at runtime: which form
  // surfaces sync, the EU opt-in default, and the per-form-type lifecycle
  // mapping written onto the contact at upsert. `hubspotTimelineAppId` is the
  // numeric app id assigned when the custom timeline event types are
  // registered with the HubSpot Public App.
  hubspotEnabled: boolean("hubspot_enabled").notNull().default(false),
  hubspotTimelineAppId: text("hubspot_timeline_app_id"),
  hubspotEuOptInDefault: boolean("hubspot_eu_opt_in_default").notNull().default(false),
  hubspotFormToggles: jsonb("hubspot_form_toggles").$type<Record<string, boolean>>(),
  hubspotLifecycleMappings: jsonb("hubspot_lifecycle_mappings").$type<Record<string, string>>(),

  // Hero background type: "image" (default) or "video". Controls whether the
  // homepage hero shows the static image or the bundled background video.
  homeHeroBackgroundType: text("home_hero_background_type").notNull().default("image"),

  // Custom hero background video. When set, the hero <video> element uses this
  // asset's storage URL instead of the bundled /videos/hero-bg.mov.
  // Null means "use the bundled default".
  homeHeroVideoAssetId: integer("home_hero_video_asset_id"),
  homeHeroVideoMediaId: uuid("home_hero_video_media_id").references(
    () => mediaTable.id,
    { onDelete: "set null" },
  ),

  // Site theme: "cosmic" (default) or "aurora". Controls which CSS token set
  // is applied site-wide. Chosen by an admin in Site Settings.
  siteTheme: text("site_theme").notNull().default("cosmic"),

  // #125: Admin-tunable session idle timeout (milliseconds). When null we fall
  // back to the IDLE_TIMEOUT_MS env var, which itself falls back to a 4 hour
  // default. resolveSession() always clamps the effective value to at least
  // ROLLING_RENEW_MS to prevent false sign-outs of active users between
  // lastSeenAt heartbeat bumps.
  idleTimeoutMs: integer("idle_timeout_ms"),

  // #126: Microsoft Entra SSO. The tenant id is published so the api-server
  // can scope token validation; `entraAdminGroupFallback` is a per-tenant
  // safety net used while the `entra_group_role_mappings` table is being
  // populated — any user in this group is granted `admin` regardless of the
  // mapping table's contents.
  entraEnabled: boolean("entra_enabled").notNull().default(false),
  entraTenantId: text("entra_tenant_id"),
  entraAdminGroupFallback: text("entra_admin_group_fallback"),

  // #54: Spam detection rules. All fields are nullable so new deployments
  // fall back to sensible hard-coded defaults without a migration.
  // spamLinkThreshold: max external links allowed before a comment is
  //   flagged (default 3).
  // spamKeywords: blocked keyword/phrase list matched case-insensitively.
  // spamDomainBlocklist: email domains that are immediately flagged.
  spamLinkThreshold: integer("spam_link_threshold"),
  spamKeywords: jsonb("spam_keywords").$type<string[]>(),
  spamDomainBlocklist: jsonb("spam_domain_blocklist").$type<string[]>(),

  // Bookings rendering mode. "iframe" (default) renders Microsoft's hosted
  // Bookings page in an iframe — zero-config but cross-origin so the inner
  // styling can't be themed. "native" calls Microsoft Graph from the
  // api-server and renders a custom on-brand flow. Integrated mode uses the
  // existing ENTRA_* env vars (no separate MS_BOOKINGS_* vars required) and
  // a populated `bookings.ms_business_id` column; rows missing that config
  // fall back to iframe per-row even when the global mode is "native".
  bookingsRenderMode: text("bookings_render_mode").notNull().default("iframe"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
