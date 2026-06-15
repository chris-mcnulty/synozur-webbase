import {
  pgTable,
  integer,
  boolean,
  text,
  timestamp,
  jsonb,
  uuid,
  doublePrecision,
} from "drizzle-orm/pg-core";
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

  // #269: LocalBusiness JSON-LD office contact fields. These supplement the
  // existing address columns above so the /contact LocalBusiness blob can
  // expose phone, geo coordinates, and opening hours without a code deploy.
  // All fields are nullable; LocalBusinessJsonLd falls back to its hard-coded
  // Mill Creek defaults when a column is null.
  orgTelephone: text("org_telephone"),
  orgGeoLatitude: doublePrecision("org_geo_latitude"),
  orgGeoLongitude: doublePrecision("org_geo_longitude"),
  orgOpeningHours: jsonb("org_opening_hours").$type<
    { days: string[]; opens: string; closes: string }[]
  >(),

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

  // Alt Home (/home-b) hero overrides. When any of these are null, the
  // /home-b page falls back to the corresponding `homeHero*` field above so
  // the two pages stay in sync until an admin explicitly diverges them.
  // `homeBHeroBackgroundType` is nullable (unlike `homeHeroBackgroundType`
  // which has a non-null "image" default) so "unset → inherit from original"
  // is representable.
  homeBHeroImageMediaId: uuid("home_b_hero_image_media_id").references(
    () => mediaTable.id,
    { onDelete: "set null" },
  ),
  homeBHeroVideoMediaId: uuid("home_b_hero_video_media_id").references(
    () => mediaTable.id,
    { onDelete: "set null" },
  ),
  homeBHeroBackgroundType: text("home_b_hero_background_type"),

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

  // #127: SharePoint Embedded asset storage. Auth credentials
  // (ENTRA_TENANT_ID / ENTRA_APP_CLIENT_ID / ENTRA_APP_CLIENT_SECRET) stay in
  // env; the runtime config below is admin-managed because container IDs are
  // produced by the SPE provisioning flow at runtime, not baked at deploy.
  // `speContainerTypeId` is the GUID Azure issues when the container type is
  // created in Synozur's tenant (one-time setup); the dev/prod container IDs
  // are stamped onto this row when an admin clicks "Create container".
  // `storageBackendDev` / `storageBackendProd` are the per-environment backend
  // selectors ('gcs' | 'spe'); null defaults to 'gcs'. Stored in DB (not env)
  // so dev and prod can be switched independently from the admin UI without a
  // redeploy. The old `speStorageEnabled` boolean is kept but no longer read.
  speStorageEnabled: boolean("spe_storage_enabled").notNull().default(false),
  speContainerTypeId: text("spe_container_type_id"),
  speContainerIdDev: text("spe_container_id_dev"),
  speContainerIdProd: text("spe_container_id_prod"),
  storageBackendDev: text("storage_backend_dev"),
  storageBackendProd: text("storage_backend_prod"),

  // #54: Spam detection rules. All fields are nullable so new deployments
  // fall back to sensible hard-coded defaults without a migration.
  // spamLinkThreshold: max external links allowed before a comment is
  //   flagged (default 3).
  // spamKeywords: blocked keyword/phrase list matched case-insensitively.
  // spamDomainBlocklist: email domains that are immediately flagged.
  spamLinkThreshold: integer("spam_link_threshold"),
  spamKeywords: jsonb("spam_keywords").$type<string[]>(),
  spamDomainBlocklist: jsonb("spam_domain_blocklist").$type<string[]>(),

  // Which homepage variant is served at the root URL ("/"). "a" (default) =
  // the original Home; "b" = the Alt Home (HomeB) design. The non-active
  // variant remains accessible at its alternate path (/home-a or /home-b)
  // so admins can still preview both side-by-side without a code change.
  homeRootVariant: text("home_root_variant").notNull().default("a"),

  // #215: Editable copy for the alt home page (`/home-b`). Each field is
  // nullable; when null the page renders the hard-coded defaults baked into
  // `home-b.tsx`. Lets non-technical admins iterate on hero, pillars, and
  // closing CTA copy without a code deploy.
  homeBHeroHeadlinePrefix: text("home_b_hero_headline_prefix"),
  homeBHeroHeadlineAccent: text("home_b_hero_headline_accent"),
  homeBHeroHeadlineSuffix: text("home_b_hero_headline_suffix"),
  homeBHeroSubheadline: text("home_b_hero_subheadline"),
  homeBPillarsEyebrow: text("home_b_pillars_eyebrow"),
  homeBPillarsHeadline: text("home_b_pillars_headline"),
  homeBPillar1Headline: text("home_b_pillar1_headline"),
  homeBPillar1Body: text("home_b_pillar1_body"),
  homeBPillar2Headline: text("home_b_pillar2_headline"),
  homeBPillar2Body: text("home_b_pillar2_body"),
  homeBPillar3Headline: text("home_b_pillar3_headline"),
  homeBPillar3Body: text("home_b_pillar3_body"),
  homeBPillar4Headline: text("home_b_pillar4_headline"),
  homeBPillar4Body: text("home_b_pillar4_body"),
  homeBClosingEyebrow: text("home_b_closing_eyebrow"),
  homeBClosingHeadline: text("home_b_closing_headline"),
  homeBClosingBody: text("home_b_closing_body"),

  // Bookings rendering mode. "iframe" (default) renders Microsoft's hosted
  // Bookings page in an iframe — zero-config but cross-origin so the inner
  // styling can't be themed. "native" calls Microsoft Graph from the
  // api-server and renders a custom on-brand flow. Integrated mode uses the
  // existing ENTRA_* env vars (no separate MS_BOOKINGS_* vars required) and
  // a populated `bookings.ms_business_id` column; rows missing that config
  // fall back to iframe per-row even when the global mode is "native".
  bookingsRenderMode: text("bookings_render_mode").notNull().default("iframe"),

  // #133 — Constellation interactive demo on /applications/constellation.
  // Server-controlled kill-switch so the team can disable the demo without a
  // redeploy (e.g. if the AI integration is misbehaving or we want to flip
  // back to the static control arm during an experiment). Per-visitor URL
  // overrides (`?demo=on|off`) layer on top of this flag client-side. When
  // #140 ships proper bucketing, this column becomes the "globally enabled"
  // gate that the bucketing framework consults before assigning treatments.
  constellationDemoEnabled: boolean("constellation_demo_enabled").notNull().default(true),

  // Pre-launch sign-off flags for the /trust page's two REVIEW-BEFORE-LAUNCH
  // items, surfaced on the admin Launch Readiness dashboard (TRUST group).
  // trustComplianceReviewed: the "Compliance & documentation" wording has been
  // confirmed (and any formal attestations named). trustSecurityMailboxReady:
  // a monitored security@ disclosure mailbox is live.
  trustComplianceReviewed: boolean("trust_compliance_reviewed").notNull().default(false),
  trustSecurityMailboxReady: boolean("trust_security_mailbox_ready").notNull().default(false),

  // #223 — Careers section. `careersMode` controls whether `/careers/*` is
  // hosted natively from this site or 301-redirected to an external careers
  // host (preserving the path tail). `careersExternalUrl` is the redirect
  // target — required when mode is "redirect" but stored unconditionally so
  // admins can prep the URL before flipping the switch. `careersEeoEnabled`
  // governs whether the EEO demographic questions appear on the apply form.
  // `careersDefaultHiringManager` is the fallback notification address when
  // a job posting has no explicit hiring-manager email set.
  careersMode: text("careers_mode").notNull().default("native"),
  careersExternalUrl: text("careers_external_url"),
  careersEeoEnabled: boolean("careers_eeo_enabled").notNull().default(true),
  careersDefaultHiringManager: text("careers_default_hiring_manager"),

  // #169 — Audit log retention. The daily prune job in scheduler.ts deletes
  // audit_log rows older than this many days. Auth/oauth/session actions
  // are exempt (5-year retention regardless) — see scheduler.ts.
  auditLogRetentionDays: integer("audit_log_retention_days").notNull().default(365),

  // #166 — AI chat token-budget caps. Null means "use the hard-coded default"
  // in `lib/aiChatBudget.ts` (50k per session/IP, 5M global). Editable from
  // the admin Site Health page so on-call can tighten limits without a deploy.
  aiChatDailyTokenCapPerSession: integer("ai_chat_daily_token_cap_per_session"),
  aiChatDailyTokenCapGlobal: integer("ai_chat_daily_token_cap_global"),

  // #170 — Per-kind ranking multipliers for the public search endpoint.
  // Postgres FTS produces a `ts_rank_cd` score in [0, ~1]; this map is
  // multiplied into that score so commercial pages (services, solutions)
  // can outrank blog posts on equal-relevance ties without baking the
  // weights into application code. Keys are search kinds: `post`,
  // `case_study`, `white_paper`, `service`, `solution`, `faq`,
  // `polaris_episode`, `application`, `model`. When null, the route
  // falls back to a hard-coded default map.
  searchKindBoosts: jsonb("search_kind_boosts").$type<Record<string, number>>(),

  // Dismissable announcement bar. When `announcementEnabled` is true and
  // `announcementText` is non-null, a single-line bar renders above the
  // main site header. `announcementLinkText` / `announcementLinkUrl` are
  // optional — when both are set, an inline link appears at the end of the
  // message. Dismissal is persisted client-side (localStorage) keyed to
  // the text content so changing the message re-shows the bar.
  announcementEnabled: boolean("announcement_enabled").notNull().default(false),
  announcementText: text("announcement_text"),
  announcementLinkText: text("announcement_link_text"),
  announcementLinkUrl: text("announcement_link_url"),

  // Branded short-link service (aka.synozur.com/<slug>) — admin-tunable so
  // we don't ship hostnames or fallback URLs in env vars.
  // `shortLinkPublicBase` is the canonical https origin embedded in QR
  // codes and copied from the admin UI; null falls back to the hard-coded
  // default `https://aka.synozur.com`. The hostname parsed from this value
  // is automatically treated as a short-link host by the redirect
  // middleware.
  // `shortLinkAdditionalHosts` lists every extra hostname the redirect
  // middleware should treat as a short-link host (in addition to the host
  // parsed from `shortLinkPublicBase`). Useful for staging aliases or
  // local-dev (`aka.localhost`).
  // `shortLinkFallbackUrl` is the "where do you actually want to go?"
  // suggestion offered on the 404 page when an unknown slug is requested.
  // Null suppresses the suggestion entirely.
  shortLinkPublicBase: text("short_link_public_base"),
  shortLinkAdditionalHosts: jsonb("short_link_additional_hosts").$type<string[]>(),
  shortLinkFallbackUrl: text("short_link_fallback_url"),
  // Rebrandly API key for the "Import from Rebrandly" admin flow. Stored in
  // DB rather than env so admins can rotate keys without a redeploy. Never
  // returned in plaintext from the settings GET endpoint — the route masks
  // it to `last4` form (e.g. `••••dfa4`) and the PUT endpoint treats an
  // omitted/empty `rebrandlyApiKey` as "leave the existing key alone" so
  // accidentally re-saving the form doesn't clobber it.
  shortLinkRebrandlyApiKey: text("short_link_rebrandly_api_key"),

  // Briefing Podcast — M365 mailbox address that the Graph subscription
  // watches for inbound briefing emails. Stored here so admins can update it
  // without a redeploy. Null means the feature is inactive.
  briefingMailbox: text("briefing_mailbox"),

  // When true, inbound briefing messages are deleted from the watched mailbox
  // after processing (keeping it clean). When false (the default), messages
  // are left in place so admins can inspect them. Toggle centrally from the
  // Briefing Podcast settings page when ready.
  briefingDeleteInbound: boolean("briefing_delete_inbound").notNull().default(false),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
