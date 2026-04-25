import { pgTable, integer, boolean, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const siteSettingsTable = pgTable("site_settings", {
  id: integer("id").primaryKey().default(1),
  requireCookieConsent: boolean("require_cookie_consent").notNull().default(false),
  homeHeroImageAssetId: integer("home_hero_image_asset_id"),
  homeEditorialImageAssetId: integer("home_editorial_image_asset_id"),
  // Libsyn RSS feed URL for the Polaris podcast. Admin-configurable source for
  // the "Import from Libsyn" flow on the Polaris episodes admin page.
  polarisFeedUrl: text("polaris_feed_url"),

  // SEO defaults (null ⇒ use the hard-coded fallback in seo-config.ts / Meta)
  seoDefaultTitleTemplate: text("seo_default_title_template"),
  seoDefaultDescription: text("seo_default_description"),
  seoDefaultOgImageAssetId: integer("seo_default_og_image_asset_id"),

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

  // #126: Microsoft Entra SSO. The tenant id is published so the api-server
  // can scope token validation; `entraAdminGroupFallback` is a per-tenant
  // safety net used while the `entra_group_role_mappings` table is being
  // populated — any user in this group is granted `admin` regardless of the
  // mapping table's contents.
  entraEnabled: boolean("entra_enabled").notNull().default(false),
  entraTenantId: text("entra_tenant_id"),
  entraAdminGroupFallback: text("entra_admin_group_fallback"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
