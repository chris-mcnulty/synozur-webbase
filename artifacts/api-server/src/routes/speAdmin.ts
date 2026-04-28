// #127 Phase 2 — admin surface for SharePoint Embedded.
//
// Auth credentials (ENTRA_TENANT_ID / ENTRA_APP_CLIENT_ID /
// ENTRA_APP_CLIENT_SECRET) stay in env. Everything else — container
// type id, dev/prod container ids, master enable flag — is admin-tunable
// and persisted on `site_settings`.
//
// Endpoints:
//   GET   /admin/integrations/spe/status
//   POST  /admin/integrations/spe/register-container-type
//   POST  /admin/integrations/spe/container         { slot: "dev"|"prod", displayName, description? }
//   PATCH /admin/integrations/spe/settings          { speStorageEnabled?, speContainerTypeId? }

import { Router, type IRouter } from "express";
import { eq, isNull, count } from "drizzle-orm";
import { z } from "zod";
import { db, siteSettingsTable, mediaTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { audit } from "../lib/audit";
import { readSpeGraphConfigFromEnv, SpeGraphClient } from "../lib/storage/spe/graphClient";
import { SpeContainerCreator } from "../lib/storage/spe/containerCreator";

const SETTINGS_ID = 1;

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/integrations/spe/status
// ---------------------------------------------------------------------------
router.get(
  "/admin/integrations/spe/status",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const settings = await db.query.siteSettingsTable.findFirst({
      where: eq(siteSettingsTable.id, SETTINGS_ID),
    });
    const cfg = readSpeGraphConfigFromEnv();
    res.json({
      credentialsConfigured: cfg !== null,
      tenantId: cfg?.tenantId ?? null,
      enabled: settings?.speStorageEnabled === true,
      containerTypeId: settings?.speContainerTypeId ?? null,
      containerIdDev: settings?.speContainerIdDev ?? null,
      containerIdProd: settings?.speContainerIdProd ?? null,
      activeBackend: process.env["STORAGE_BACKEND"] ?? "gcs",
    });
  },
);

// ---------------------------------------------------------------------------
// POST /admin/integrations/spe/register-container-type
// Idempotent — call once per environment after creating the container type
// in the Azure Portal. Reads `containerTypeId` from request body or, if
// unset, from site_settings.
// ---------------------------------------------------------------------------
const registerBody = z.object({
  containerTypeId: z.string().min(1).optional(),
});

router.post(
  "/admin/integrations/spe/register-container-type",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = registerBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const settings = await db.query.siteSettingsTable.findFirst({
      where: eq(siteSettingsTable.id, SETTINGS_ID),
    });
    const containerTypeId =
      parsed.data.containerTypeId ?? settings?.speContainerTypeId ?? null;
    if (!containerTypeId) {
      res.status(400).json({
        error:
          "containerTypeId not provided and not stored in site_settings — pass one in the body or PATCH settings first",
      });
      return;
    }
    let graph: SpeGraphClient;
    try {
      graph = new SpeGraphClient();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
    try {
      await new SpeContainerCreator(graph).registerContainerType(containerTypeId);
    } catch (err) {
      req.log.error({ err, containerTypeId }, "SPE registerContainerType failed");
      res.status(502).json({ error: (err as Error).message });
      return;
    }
    // Persist the type id on the row if it wasn't already there.
    if (!settings?.speContainerTypeId || settings.speContainerTypeId !== containerTypeId) {
      await db
        .insert(siteSettingsTable)
        .values({ id: SETTINGS_ID, speContainerTypeId: containerTypeId })
        .onConflictDoUpdate({
          target: siteSettingsTable.id,
          set: { speContainerTypeId: containerTypeId },
        });
    }
    await audit({
      actorId: req.authedUser!.id,
      action: "spe.containerType.register",
      entity: "site_settings",
      entityId: String(SETTINGS_ID),
      diff: { containerTypeId },
    });
    res.json({ ok: true, containerTypeId });
  },
);

// ---------------------------------------------------------------------------
// POST /admin/integrations/spe/container
// Creates a new container and stores the resulting id on the dev or prod slot.
// ---------------------------------------------------------------------------
const createContainerBody = z.object({
  slot: z.enum(["dev", "prod"]),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

router.post(
  "/admin/integrations/spe/container",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = createContainerBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const settings = await db.query.siteSettingsTable.findFirst({
      where: eq(siteSettingsTable.id, SETTINGS_ID),
    });
    const containerTypeId = settings?.speContainerTypeId;
    if (!containerTypeId) {
      res.status(400).json({
        error:
          "speContainerTypeId not configured — PATCH /admin/integrations/spe/settings first",
      });
      return;
    }
    let graph: SpeGraphClient;
    try {
      graph = new SpeGraphClient();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
    let created;
    try {
      created = await new SpeContainerCreator(graph).createContainer({
        displayName: parsed.data.displayName,
        description: parsed.data.description,
        containerTypeId,
      });
    } catch (err) {
      req.log.error({ err, containerTypeId }, "SPE createContainer failed");
      res.status(502).json({ error: (err as Error).message });
      return;
    }
    const slotColumn =
      parsed.data.slot === "prod" ? "speContainerIdProd" : "speContainerIdDev";
    await db
      .insert(siteSettingsTable)
      .values({ id: SETTINGS_ID, [slotColumn]: created.containerId })
      .onConflictDoUpdate({
        target: siteSettingsTable.id,
        set: { [slotColumn]: created.containerId },
      });
    await audit({
      actorId: req.authedUser!.id,
      action: "spe.container.create",
      entity: "site_settings",
      entityId: String(SETTINGS_ID),
      diff: {
        slot: parsed.data.slot,
        containerId: created.containerId,
        displayName: created.displayName,
      },
    });
    res.json({
      ok: true,
      slot: parsed.data.slot,
      containerId: created.containerId,
      displayName: created.displayName,
      status: created.status,
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /admin/integrations/spe/settings
// Update the runtime knobs (enable flag, container type id).
// ---------------------------------------------------------------------------
const patchSettingsBody = z
  .object({
    speStorageEnabled: z.boolean().optional(),
    speContainerTypeId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (v) => v.speStorageEnabled !== undefined || v.speContainerTypeId !== undefined,
    { message: "Must set at least one of speStorageEnabled or speContainerTypeId" },
  );

router.patch(
  "/admin/integrations/spe/settings",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = patchSettingsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const updates: Partial<typeof siteSettingsTable.$inferInsert> = {};
    if (parsed.data.speStorageEnabled !== undefined) {
      updates.speStorageEnabled = parsed.data.speStorageEnabled;
    }
    if (parsed.data.speContainerTypeId !== undefined) {
      updates.speContainerTypeId = parsed.data.speContainerTypeId ?? null;
    }
    await db
      .insert(siteSettingsTable)
      .values({ id: SETTINGS_ID, ...updates })
      .onConflictDoUpdate({ target: siteSettingsTable.id, set: updates });
    await audit({
      actorId: req.authedUser!.id,
      action: "spe.settings.update",
      entity: "site_settings",
      entityId: String(SETTINGS_ID),
      diff: updates,
    });
    res.json({ ok: true, updated: updates });
  },
);

// ---------------------------------------------------------------------------
// GET /admin/integrations/spe/migration-status
// Aggregate counts for the admin UI's Migration panel. Cheap — three
// indexed counts; safe to poll at human-scale intervals (every ~10s
// during a migration run). The actual migrate work runs as a CLI
// script; this endpoint just shows where it's gotten to.
// ---------------------------------------------------------------------------
router.get(
  "/admin/integrations/spe/migration-status",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const [totalRow] = await db.select({ n: count() }).from(mediaTable);
    const [pendingRow] = await db
      .select({ n: count() })
      .from(mediaTable)
      .where(isNull(mediaTable.speFileId));
    const total = totalRow?.n ?? 0;
    const pending = pendingRow?.n ?? 0;
    res.json({
      totalMedia: total,
      migratedToSpe: total - pending,
      awaitingMigration: pending,
    });
  },
);

export default router;
