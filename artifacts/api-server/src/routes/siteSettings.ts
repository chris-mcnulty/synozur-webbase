import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, siteSettingsTable, assetsTable, type SiteSettings, type Asset } from "@workspace/db";
import {
  GetPublicSiteSettingsResponse,
  GetAdminSiteSettingsResponse,
  UpdateAdminSiteSettingsBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";

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

type ResolvedImageUrls = {
  homeHeroImageUrl: string | null;
  homeEditorialImageUrl: string | null;
  seoDefaultOgImageUrl: string | null;
  orgLogoUrl: string | null;
};

async function resolveImageUrls(settings: SiteSettings): Promise<ResolvedImageUrls> {
  const ids = [
    settings.homeHeroImageAssetId,
    settings.homeEditorialImageAssetId,
    settings.seoDefaultOgImageAssetId,
    settings.orgLogoAssetId,
  ].filter((id): id is number => typeof id === "number");
  if (ids.length === 0) {
    return {
      homeHeroImageUrl: null,
      homeEditorialImageUrl: null,
      seoDefaultOgImageUrl: null,
      orgLogoUrl: null,
    };
  }
  const rows = await db
    .select()
    .from(assetsTable)
    .where(inArray(assetsTable.id, ids));
  const byId = new Map(rows.map((a) => [a.id, a]));
  const urlFor = (id: number | null) =>
    imageUrlFor(id !== null ? byId.get(id) : undefined);
  return {
    homeHeroImageUrl: urlFor(settings.homeHeroImageAssetId),
    homeEditorialImageUrl: urlFor(settings.homeEditorialImageAssetId),
    seoDefaultOgImageUrl: urlFor(settings.seoDefaultOgImageAssetId),
    orgLogoUrl: urlFor(settings.orgLogoAssetId),
  };
}

function buildAdminResponse(settings: SiteSettings, urls: ResolvedImageUrls) {
  return GetAdminSiteSettingsResponse.parse({
    requireCookieConsent: settings.requireCookieConsent,
    homeHeroImageAssetId: settings.homeHeroImageAssetId,
    homeHeroImageUrl: urls.homeHeroImageUrl,
    homeEditorialImageAssetId: settings.homeEditorialImageAssetId,
    homeEditorialImageUrl: urls.homeEditorialImageUrl,
    polarisFeedUrl: settings.polarisFeedUrl,
    seoDefaultTitleTemplate: settings.seoDefaultTitleTemplate,
    seoDefaultDescription: settings.seoDefaultDescription,
    seoDefaultOgImageAssetId: settings.seoDefaultOgImageAssetId,
    seoDefaultOgImageUrl: urls.seoDefaultOgImageUrl,
    seoTwitterHandle: settings.seoTwitterHandle,
    seoTwitterCardType: settings.seoTwitterCardType,
    seoLinkedinCompanyUrl: settings.seoLinkedinCompanyUrl,
    seoGoogleSiteVerification: settings.seoGoogleSiteVerification,
    seoBingSiteVerification: settings.seoBingSiteVerification,
    orgName: settings.orgName,
    orgLegalName: settings.orgLegalName,
    orgLogoAssetId: settings.orgLogoAssetId,
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
      homeHeroImageUrl: urls.homeHeroImageUrl,
      homeEditorialImageUrl: urls.homeEditorialImageUrl,
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
  const updates: Partial<typeof siteSettingsTable.$inferInsert> = {
    requireCookieConsent: input.requireCookieConsent,
  };

  if ("homeHeroImageAssetId" in input) {
    updates.homeHeroImageAssetId = input.homeHeroImageAssetId ?? null;
  }
  if ("homeEditorialImageAssetId" in input) {
    updates.homeEditorialImageAssetId = input.homeEditorialImageAssetId ?? null;
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

  const [updated] = await db
    .update(siteSettingsTable)
    .set(updates)
    .where(eq(siteSettingsTable.id, SETTINGS_ID))
    .returning();
  const urls = await resolveImageUrls(updated!);
  res.json(buildAdminResponse(updated!, urls));
});

export default router;
