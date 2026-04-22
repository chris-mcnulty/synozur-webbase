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

async function resolveImageUrls(settings: SiteSettings): Promise<{
  homeHeroImageUrl: string | null;
  homeEditorialImageUrl: string | null;
}> {
  const ids = [
    settings.homeHeroImageAssetId,
    settings.homeEditorialImageAssetId,
  ].filter((id): id is number => typeof id === "number");
  if (ids.length === 0) {
    return { homeHeroImageUrl: null, homeEditorialImageUrl: null };
  }
  const rows = await db
    .select()
    .from(assetsTable)
    .where(inArray(assetsTable.id, ids));
  const byId = new Map(rows.map((a) => [a.id, a]));
  return {
    homeHeroImageUrl: imageUrlFor(
      settings.homeHeroImageAssetId ? byId.get(settings.homeHeroImageAssetId) : undefined,
    ),
    homeEditorialImageUrl: imageUrlFor(
      settings.homeEditorialImageAssetId
        ? byId.get(settings.homeEditorialImageAssetId)
        : undefined,
    ),
  };
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
    }),
  );
});

router.get("/admin/site-settings", requireAdmin, async (_req, res): Promise<void> => {
  const settings = await loadOrCreateSettings();
  const urls = await resolveImageUrls(settings);
  res.json(
    GetAdminSiteSettingsResponse.parse({
      requireCookieConsent: settings.requireCookieConsent,
      homeHeroImageAssetId: settings.homeHeroImageAssetId,
      homeHeroImageUrl: urls.homeHeroImageUrl,
      homeEditorialImageAssetId: settings.homeEditorialImageAssetId,
      homeEditorialImageUrl: urls.homeEditorialImageUrl,
      polarisFeedUrl: settings.polarisFeedUrl,
      updatedAt: settings.updatedAt,
    }),
  );
});

router.patch("/admin/site-settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSiteSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await loadOrCreateSettings();
  const updates: Partial<typeof siteSettingsTable.$inferInsert> = {
    requireCookieConsent: parsed.data.requireCookieConsent,
  };
  if ("homeHeroImageAssetId" in parsed.data) {
    updates.homeHeroImageAssetId = parsed.data.homeHeroImageAssetId ?? null;
  }
  if ("homeEditorialImageAssetId" in parsed.data) {
    updates.homeEditorialImageAssetId = parsed.data.homeEditorialImageAssetId ?? null;
  }
  if ("polarisFeedUrl" in parsed.data) {
    const raw = parsed.data.polarisFeedUrl;
    const trimmed = typeof raw === "string" ? raw.trim() : raw;
    updates.polarisFeedUrl = trimmed ? trimmed : null;
  }
  const [updated] = await db
    .update(siteSettingsTable)
    .set(updates)
    .where(eq(siteSettingsTable.id, SETTINGS_ID))
    .returning();
  const urls = await resolveImageUrls(updated!);
  res.json(
    GetAdminSiteSettingsResponse.parse({
      requireCookieConsent: updated!.requireCookieConsent,
      homeHeroImageAssetId: updated!.homeHeroImageAssetId,
      homeHeroImageUrl: urls.homeHeroImageUrl,
      homeEditorialImageAssetId: updated!.homeEditorialImageAssetId,
      homeEditorialImageUrl: urls.homeEditorialImageUrl,
      polarisFeedUrl: updated!.polarisFeedUrl,
      updatedAt: updated!.updatedAt,
    }),
  );
});

export default router;
