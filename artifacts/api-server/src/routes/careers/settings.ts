import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";
import { requireAuth, requireCapability } from "../../middlewares/auth";
import { audit } from "../../lib/audit";
import { invalidateCareersSettings } from "../../lib/careersRedirect";

const router: IRouter = Router();

const SETTINGS_ID = 1;

function serialize(row: {
  careersMode: string;
  careersExternalUrl: string | null;
  careersEeoEnabled: boolean;
  careersDefaultHiringManager: string | null;
}) {
  return {
    mode: row.careersMode === "redirect" ? "redirect" : "native",
    externalUrl: row.careersExternalUrl,
    eeoEnabled: row.careersEeoEnabled,
    defaultHiringManager: row.careersDefaultHiringManager,
  };
}

// Public read so the SPA shell knows whether to render native pages or
// fall back to the external URL for header/footer links.
router.get("/careers/settings", async (_req, res) => {
  const [row] = await db
    .select({
      careersMode: siteSettingsTable.careersMode,
      careersExternalUrl: siteSettingsTable.careersExternalUrl,
      careersEeoEnabled: siteSettingsTable.careersEeoEnabled,
      careersDefaultHiringManager: siteSettingsTable.careersDefaultHiringManager,
    })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SETTINGS_ID));
  res.json(
    row
      ? serialize(row)
      : { mode: "native", externalUrl: null, eeoEnabled: true, defaultHiringManager: null },
  );
});

router.get(
  "/cms/careers/settings",
  requireAuth,
  requireCapability("careers.settings.manage"),
  async (_req, res) => {
    const [row] = await db
      .select({
        careersMode: siteSettingsTable.careersMode,
        careersExternalUrl: siteSettingsTable.careersExternalUrl,
        careersEeoEnabled: siteSettingsTable.careersEeoEnabled,
        careersDefaultHiringManager: siteSettingsTable.careersDefaultHiringManager,
      })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ID));
    res.json(
      row
        ? serialize(row)
        : { mode: "native", externalUrl: null, eeoEnabled: true, defaultHiringManager: null },
    );
  },
);

const PatchBody = z.object({
  mode: z.enum(["native", "redirect"]).optional(),
  externalUrl: z
    .string()
    .url()
    .max(500)
    .nullish()
    .or(z.literal("")),
  eeoEnabled: z.boolean().optional(),
  defaultHiringManager: z.string().email().nullish().or(z.literal("")),
});

router.patch(
  "/cms/careers/settings",
  requireAuth,
  requireCapability("careers.settings.manage"),
  async (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    if (d.mode === "redirect") {
      const url = d.externalUrl;
      if (!url || url === "") {
        res.status(400).json({ error: "externalUrl is required when mode is 'redirect'" });
        return;
      }
    }
    // Make sure a settings row exists.
    await db
      .insert(siteSettingsTable)
      .values({ id: SETTINGS_ID, requireCookieConsent: false })
      .onConflictDoNothing({ target: siteSettingsTable.id });

    const updates: Partial<typeof siteSettingsTable.$inferInsert> = {};
    if (d.mode !== undefined) updates.careersMode = d.mode;
    if (d.externalUrl !== undefined) {
      updates.careersExternalUrl = d.externalUrl ? d.externalUrl : null;
    }
    if (d.eeoEnabled !== undefined) updates.careersEeoEnabled = d.eeoEnabled;
    if (d.defaultHiringManager !== undefined) {
      updates.careersDefaultHiringManager = d.defaultHiringManager
        ? d.defaultHiringManager
        : null;
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(siteSettingsTable)
        .set(updates)
        .where(eq(siteSettingsTable.id, SETTINGS_ID));
    }
    invalidateCareersSettings();
    await audit({
      actorId: req.authedUser!.id,
      action: "careers.settings.update",
      entity: "site_settings",
      entityId: String(SETTINGS_ID),
      diff: updates,
    });
    const [row] = await db
      .select({
        careersMode: siteSettingsTable.careersMode,
        careersExternalUrl: siteSettingsTable.careersExternalUrl,
        careersEeoEnabled: siteSettingsTable.careersEeoEnabled,
        careersDefaultHiringManager: siteSettingsTable.careersDefaultHiringManager,
      })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ID));
    res.json(serialize(row!));
  },
);

export default router;
