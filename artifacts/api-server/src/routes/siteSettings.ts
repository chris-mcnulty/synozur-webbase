import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, siteSettingsTable, type SiteSettings } from "@workspace/db";
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

router.get("/site-settings", async (_req, res): Promise<void> => {
  const settings = await loadOrCreateSettings();
  res.set("Cache-Control", "public, max-age=60");
  res.json(
    GetPublicSiteSettingsResponse.parse({
      requireCookieConsent: settings.requireCookieConsent,
    }),
  );
});

router.get("/admin/site-settings", requireAdmin, async (_req, res): Promise<void> => {
  const settings = await loadOrCreateSettings();
  res.json(
    GetAdminSiteSettingsResponse.parse({
      requireCookieConsent: settings.requireCookieConsent,
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
  const [updated] = await db
    .update(siteSettingsTable)
    .set({ requireCookieConsent: parsed.data.requireCookieConsent })
    .where(eq(siteSettingsTable.id, SETTINGS_ID))
    .returning();
  res.json(
    GetAdminSiteSettingsResponse.parse({
      requireCookieConsent: updated!.requireCookieConsent,
      updatedAt: updated!.updatedAt,
    }),
  );
});

export default router;
