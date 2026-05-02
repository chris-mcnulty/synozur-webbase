import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  siteSettingsTable,
  assetsTable,
  mediaTable,
  type SiteSettings,
  type Asset,
  type Media,
} from "@workspace/db";
import {
  GetPublicSiteSettingsResponse,
  GetAdminSiteSettingsResponse,
  UpdateAdminSiteSettingsBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { invalidateIdleTimeoutCache } from "../lib/sessions";
import { invalidateSpamRulesCache } from "../lib/spamScorer";

const router: IRouter = Router();

const SETTINGS_ID = 1;

async function loadOrCreateSettings(): Promise<SiteSettings> {
  const [existing] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SETTINGS_ID));
  if (existing) return existing;
  const [created] = await db
    .insert(siteSettingsTable)
    .values({ id: SETTINGS_ID, requireCookieConsent: false })
    .onConflictDoNothing({ target: siteSettingsTable.id })
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SETTINGS_ID));
  return row!;
}

function imageUrlFor(asset: Asset | undefined): string | null {
  if (!asset) return null;
  return `/api/storage${asset.storageKey}`;
}

function mediaUrlFor(media: Media | undefined): string | null {
  if (!media) return null;
  return media.publicUrl || `/api/storage${media.storageKey}`;
}

type ResolvedImageUrls = {
  homeHeroImageUrl: string | null;
  homeHeroVideoUrl: string | null;
  homeEditorialImageUrl: string | null;
  homeBHeroImageUrl: string | null;
  homeBHeroVideoUrl: string | null;
  seoDefaultOgImageUrl: string | null;
  orgLogoUrl: string | null;
};

// Resolve display URLs for each picker slot. New writes flow through the
// `*MediaId` UUID columns, but the legacy `*AssetId` integer columns are
// still populated until BACKLOG.md §1 item 3 drops the assets table — so
// each slot prefers media when present and falls back to the asset.
async function resolveImageUrls(settings: SiteSettings): Promise<ResolvedImageUrls> {
  const assetIds = [
    settings.homeHeroImageAssetId,
    settings.homeHeroVideoAssetId,
    settings.homeEditorialImageAssetId,
    settings.seoDefaultOgImageAssetId,
    settings.orgLogoAssetId,
  ].filter((id): id is number => typeof id === "number");
  const mediaIds = [
    settings.homeHeroImageMediaId,
    settings.homeHeroVideoMediaId,
    settings.homeEditorialImageMediaId,
    settings.homeBHeroImageMediaId,
    settings.homeBHeroVideoMediaId,
    settings.seoDefaultOgImageMediaId,
    settings.orgLogoMediaId,
  ].filter((id): id is string => typeof id === "string");

  const [assetRows, mediaRows] = await Promise.all([
    assetIds.length
      ? db.select().from(assetsTable).where(inArray(assetsTable.id, assetIds))
      : Promise.resolve([]),
    mediaIds.length
      ? db.select().from(mediaTable).where(inArray(mediaTable.id, mediaIds))
      : Promise.resolve([]),
  ]);
  const assetsById = new Map(assetRows.map((a) => [a.id, a]));
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

  const urlFor = (mediaId: string | null, assetId: number | null) => {
    const m = mediaId !== null ? mediaById.get(mediaId) : undefined;
    if (m) return mediaUrlFor(m);
    return imageUrlFor(assetId !== null ? assetsById.get(assetId) : undefined);
  };

  return {
    homeHeroImageUrl: urlFor(
      settings.homeHeroImageMediaId ?? null,
      settings.homeHeroImageAssetId,
    ),
    homeHeroVideoUrl: urlFor(
      settings.homeHeroVideoMediaId ?? null,
      settings.homeHeroVideoAssetId ?? null,
    ),
    homeEditorialImageUrl: urlFor(
      settings.homeEditorialImageMediaId ?? null,
      settings.homeEditorialImageAssetId,
    ),
    homeBHeroImageUrl: urlFor(settings.homeBHeroImageMediaId ?? null, null),
    homeBHeroVideoUrl: urlFor(settings.homeBHeroVideoMediaId ?? null, null),
    seoDefaultOgImageUrl: urlFor(
      settings.seoDefaultOgImageMediaId ?? null,
      settings.seoDefaultOgImageAssetId,
    ),
    orgLogoUrl: urlFor(
      settings.orgLogoMediaId ?? null,
      settings.orgLogoAssetId,
    ),
  };
}

function buildAdminResponse(settings: SiteSettings, urls: ResolvedImageUrls) {
  return GetAdminSiteSettingsResponse.parse({
    requireCookieConsent: settings.requireCookieConsent,
    homeHeroBackgroundType: settings.homeHeroBackgroundType ?? "image",
    siteTheme: settings.siteTheme ?? "cosmic",
    bookingsRenderMode: settings.bookingsRenderMode ?? "iframe",
    homeHeroImageAssetId: settings.homeHeroImageAssetId,
    homeHeroImageMediaId: settings.homeHeroImageMediaId,
    homeHeroImageUrl: urls.homeHeroImageUrl,
    homeHeroVideoAssetId: settings.homeHeroVideoAssetId,
    homeHeroVideoMediaId: settings.homeHeroVideoMediaId,
    homeHeroVideoUrl: urls.homeHeroVideoUrl,
    homeEditorialImageAssetId: settings.homeEditorialImageAssetId,
    homeEditorialImageMediaId: settings.homeEditorialImageMediaId,
    homeEditorialImageUrl: urls.homeEditorialImageUrl,
    homeBHeroBackgroundType: settings.homeBHeroBackgroundType,
    homeBHeroImageMediaId: settings.homeBHeroImageMediaId,
    homeBHeroImageUrl: urls.homeBHeroImageUrl,
    homeBHeroVideoMediaId: settings.homeBHeroVideoMediaId,
    homeBHeroVideoUrl: urls.homeBHeroVideoUrl,
    polarisFeedUrl: settings.polarisFeedUrl,
    seoDefaultTitleTemplate: settings.seoDefaultTitleTemplate,
    seoDefaultDescription: settings.seoDefaultDescription,
    seoDefaultOgImageAssetId: settings.seoDefaultOgImageAssetId,
    seoDefaultOgImageMediaId: settings.seoDefaultOgImageMediaId,
    seoDefaultOgImageUrl: urls.seoDefaultOgImageUrl,
    seoTwitterHandle: settings.seoTwitterHandle,
    seoTwitterCardType: settings.seoTwitterCardType,
    seoLinkedinCompanyUrl: settings.seoLinkedinCompanyUrl,
    seoGoogleSiteVerification: settings.seoGoogleSiteVerification,
    seoBingSiteVerification: settings.seoBingSiteVerification,
    orgName: settings.orgName,
    orgLegalName: settings.orgLegalName,
    orgLogoAssetId: settings.orgLogoAssetId,
    orgLogoMediaId: settings.orgLogoMediaId,
    orgLogoUrl: urls.orgLogoUrl,
    orgStreetAddress: settings.orgStreetAddress,
    orgAddressLocality: settings.orgAddressLocality,
    orgAddressRegion: settings.orgAddressRegion,
    orgPostalCode: settings.orgPostalCode,
    orgAddressCountry: settings.orgAddressCountry,
    orgSameAs: settings.orgSameAs,
    tagGa4Id: settings.tagGa4Id,
    tagLinkedinPartnerId: settings.tagLinkedinPartnerId,
    tagMetaPixelId: settings.tagMetaPixelId,
    sitemapExcludedPaths: settings.sitemapExcludedPaths,
    sitemapSectionFlags: settings.sitemapSectionFlags,
    idleTimeoutMs: settings.idleTimeoutMs,
    spamLinkThreshold: settings.spamLinkThreshold,
    spamKeywords: settings.spamKeywords,
    spamDomainBlocklist: settings.spamDomainBlocklist,
    updatedAt: settings.updatedAt,
  });
}

// For any text field where "" should be normalized to null.
function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

router.get("/site-settings", async (_req, res): Promise<void> => {
  const settings = await loadOrCreateSettings();
  const urls = await resolveImageUrls(settings);
  res.set("Cache-Control", "public, max-age=60");
  res.json(
    GetPublicSiteSettingsResponse.parse({
      requireCookieConsent: settings.requireCookieConsent,
      homeHeroBackgroundType: settings.homeHeroBackgroundType ?? "image",
      siteTheme: settings.siteTheme ?? "cosmic",
      bookingsRenderMode: settings.bookingsRenderMode ?? "iframe",
      homeHeroImageUrl: urls.homeHeroImageUrl,
      homeHeroVideoUrl: urls.homeHeroVideoUrl,
      homeEditorialImageUrl: urls.homeEditorialImageUrl,
      homeBHeroBackgroundType: settings.homeBHeroBackgroundType,
      homeBHeroImageUrl: urls.homeBHeroImageUrl,
      homeBHeroVideoUrl: urls.homeBHeroVideoUrl,
      seoDefaultTitleTemplate: settings.seoDefaultTitleTemplate,
      seoDefaultDescription: settings.seoDefaultDescription,
      seoDefaultOgImageUrl: urls.seoDefaultOgImageUrl,
      seoTwitterHandle: settings.seoTwitterHandle,
      seoTwitterCardType: settings.seoTwitterCardType,
      seoGoogleSiteVerification: settings.seoGoogleSiteVerification,
      seoBingSiteVerification: settings.seoBingSiteVerification,
      tagGa4Id: settings.tagGa4Id,
      tagLinkedinPartnerId: settings.tagLinkedinPartnerId,
      tagMetaPixelId: settings.tagMetaPixelId,
      orgName: settings.orgName,
      orgLegalName: settings.orgLegalName,
      orgLogoUrl: urls.orgLogoUrl,
      orgStreetAddress: settings.orgStreetAddress,
      orgAddressLocality: settings.orgAddressLocality,
      orgAddressRegion: settings.orgAddressRegion,
      orgPostalCode: settings.orgPostalCode,
      orgAddressCountry: settings.orgAddressCountry,
      orgSameAs: settings.orgSameAs,
    }),
  );
});

router.get("/admin/site-settings", requireAdmin, async (_req, res): Promise<void> => {
  const settings = await loadOrCreateSettings();
  const urls = await resolveImageUrls(settings);
  res.json(buildAdminResponse(settings, urls));
});

router.patch("/admin/site-settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSiteSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  await loadOrCreateSettings();
  const input = parsed.data;

  // Validate any non-null *MediaId references up front. The columns FK to
  // `media`, so an unknown UUID would surface as a 500 from the constraint
  // — turn it into a 400 with a clear message instead.
  const mediaIdsToCheck = [
    input.homeHeroImageMediaId,
    input.homeHeroVideoMediaId,
    input.homeEditorialImageMediaId,
    input.homeBHeroImageMediaId,
    input.homeBHeroVideoMediaId,
    input.seoDefaultOgImageMediaId,
    input.orgLogoMediaId,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (mediaIdsToCheck.length > 0) {
    const found = await db
      .select({ id: mediaTable.id })
      .from(mediaTable)
      .where(inArray(mediaTable.id, mediaIdsToCheck));
    const foundSet = new Set(found.map((r) => r.id));
    const missing = mediaIdsToCheck.filter((id) => !foundSet.has(id));
    if (missing.length > 0) {
      res.status(400).json({
        error: "Unknown media id(s)",
        missing,
      });
      return;
    }
  }
  const updates: Partial<typeof siteSettingsTable.$inferInsert> = {
    requireCookieConsent: input.requireCookieConsent,
  };

  if ("homeHeroBackgroundType" in input && input.homeHeroBackgroundType) {
    updates.homeHeroBackgroundType = input.homeHeroBackgroundType;
  }

  if ("siteTheme" in input && input.siteTheme) {
    updates.siteTheme = input.siteTheme;
  }

  if ("bookingsRenderMode" in input && input.bookingsRenderMode) {
    updates.bookingsRenderMode = input.bookingsRenderMode;
  }

  if ("homeHeroImageAssetId" in input) {
    updates.homeHeroImageAssetId = input.homeHeroImageAssetId ?? null;
  }
  if ("homeHeroImageMediaId" in input) {
    updates.homeHeroImageMediaId = input.homeHeroImageMediaId ?? null;
  }
  if ("homeHeroVideoAssetId" in input) {
    updates.homeHeroVideoAssetId = input.homeHeroVideoAssetId ?? null;
  }
  if ("homeHeroVideoMediaId" in input) {
    updates.homeHeroVideoMediaId = input.homeHeroVideoMediaId ?? null;
  }
  if ("homeEditorialImageAssetId" in input) {
    updates.homeEditorialImageAssetId = input.homeEditorialImageAssetId ?? null;
  }
  if ("homeEditorialImageMediaId" in input) {
    updates.homeEditorialImageMediaId = input.homeEditorialImageMediaId ?? null;
  }
  if ("homeBHeroBackgroundType" in input) {
    // Distinct from `homeHeroBackgroundType` above: this column is nullable
    // so admins can clear the override and let /home-b inherit the original
    // homepage's hero background type. The schema constrains values to
    // "image" | "video" | null.
    updates.homeBHeroBackgroundType = input.homeBHeroBackgroundType ?? null;
  }
  if ("homeBHeroImageMediaId" in input) {
    updates.homeBHeroImageMediaId = input.homeBHeroImageMediaId ?? null;
  }
  if ("homeBHeroVideoMediaId" in input) {
    updates.homeBHeroVideoMediaId = input.homeBHeroVideoMediaId ?? null;
  }
  if ("polarisFeedUrl" in input) {
    updates.polarisFeedUrl = trimOrNull(input.polarisFeedUrl);
  }

  if ("seoDefaultTitleTemplate" in input) {
    updates.seoDefaultTitleTemplate = trimOrNull(input.seoDefaultTitleTemplate);
  }
  if ("seoDefaultDescription" in input) {
    updates.seoDefaultDescription = trimOrNull(input.seoDefaultDescription);
  }
  if ("seoDefaultOgImageAssetId" in input) {
    updates.seoDefaultOgImageAssetId = input.seoDefaultOgImageAssetId ?? null;
  }
  if ("seoDefaultOgImageMediaId" in input) {
    updates.seoDefaultOgImageMediaId = input.seoDefaultOgImageMediaId ?? null;
  }

  if ("seoTwitterHandle" in input) {
    updates.seoTwitterHandle = trimOrNull(input.seoTwitterHandle);
  }
  if ("seoTwitterCardType" in input) {
    updates.seoTwitterCardType = trimOrNull(input.seoTwitterCardType);
  }
  if ("seoLinkedinCompanyUrl" in input) {
    updates.seoLinkedinCompanyUrl = trimOrNull(input.seoLinkedinCompanyUrl);
  }

  if ("seoGoogleSiteVerification" in input) {
    updates.seoGoogleSiteVerification = trimOrNull(input.seoGoogleSiteVerification);
  }
  if ("seoBingSiteVerification" in input) {
    updates.seoBingSiteVerification = trimOrNull(input.seoBingSiteVerification);
  }

  if ("orgName" in input) {
    updates.orgName = trimOrNull(input.orgName);
  }
  if ("orgLegalName" in input) {
    updates.orgLegalName = trimOrNull(input.orgLegalName);
  }
  if ("orgLogoAssetId" in input) {
    updates.orgLogoAssetId = input.orgLogoAssetId ?? null;
  }
  if ("orgLogoMediaId" in input) {
    updates.orgLogoMediaId = input.orgLogoMediaId ?? null;
  }
  if ("orgStreetAddress" in input) {
    updates.orgStreetAddress = trimOrNull(input.orgStreetAddress);
  }
  if ("orgAddressLocality" in input) {
    updates.orgAddressLocality = trimOrNull(input.orgAddressLocality);
  }
  if ("orgAddressRegion" in input) {
    updates.orgAddressRegion = trimOrNull(input.orgAddressRegion);
  }
  if ("orgPostalCode" in input) {
    updates.orgPostalCode = trimOrNull(input.orgPostalCode);
  }
  if ("orgAddressCountry" in input) {
    updates.orgAddressCountry = trimOrNull(input.orgAddressCountry);
  }
  if ("orgSameAs" in input) {
    updates.orgSameAs = input.orgSameAs ?? null;
  }

  if ("tagGa4Id" in input) {
    updates.tagGa4Id = trimOrNull(input.tagGa4Id);
  }
  if ("tagLinkedinPartnerId" in input) {
    updates.tagLinkedinPartnerId = trimOrNull(input.tagLinkedinPartnerId);
  }
  if ("tagMetaPixelId" in input) {
    updates.tagMetaPixelId = trimOrNull(input.tagMetaPixelId);
  }

  if ("sitemapExcludedPaths" in input) {
    updates.sitemapExcludedPaths = input.sitemapExcludedPaths ?? null;
  }
  if ("sitemapSectionFlags" in input) {
    updates.sitemapSectionFlags = input.sitemapSectionFlags ?? null;
  }

  let idleTimeoutChanged = false;
  if ("idleTimeoutMs" in input) {
    // Treat 0 / negative as "unset" so the server falls back to the env/default.
    const next =
      typeof input.idleTimeoutMs === "number" && input.idleTimeoutMs > 0
        ? input.idleTimeoutMs
        : null;
    updates.idleTimeoutMs = next;
    idleTimeoutChanged = true;
  }

  let spamRulesChanged = false;
  if ("spamLinkThreshold" in input) {
    updates.spamLinkThreshold =
      typeof input.spamLinkThreshold === "number" && input.spamLinkThreshold > 0
        ? input.spamLinkThreshold
        : null;
    spamRulesChanged = true;
  }
  if ("spamKeywords" in input) {
    updates.spamKeywords = input.spamKeywords ?? null;
    spamRulesChanged = true;
  }
  if ("spamDomainBlocklist" in input) {
    updates.spamDomainBlocklist = input.spamDomainBlocklist ?? null;
    spamRulesChanged = true;
  }

  const [updated] = await db
    .update(siteSettingsTable)
    .set(updates)
    .where(eq(siteSettingsTable.id, SETTINGS_ID))
    .returning();
  if (idleTimeoutChanged) {
    // Drop the cached resolver value so the next session resolution picks up
    // the admin's new idle window without waiting for the cache TTL.
    invalidateIdleTimeoutCache();
  }
  if (spamRulesChanged) {
    invalidateSpamRulesCache();
  }
  const urls = await resolveImageUrls(updated!);
  res.json(buildAdminResponse(updated!, urls));
});

export default router;
