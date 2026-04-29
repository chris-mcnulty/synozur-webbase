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
import {
  scanOrphans,
  cleanupOrphans,
  speRoundTripTest,
} from "../lib/storage/spe/orphanCleaner";
import { runMigration } from "../lib/storage/spe/migrationRunner";
import { SpeNotEnabledError } from "../lib/storage/spe/fileStorage";

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
    // `activeContainerSlot` is the slot the api-server would pick at
    // request time, derived from NODE_ENV server-side. Saves the React
    // admin page from having to read process.env (which doesn't exist
    // in a Vite browser build) to make UI gating decisions.
    const activeContainerSlot: "dev" | "prod" =
      process.env["NODE_ENV"] === "production" ? "prod" : "dev";
    res.json({
      credentialsConfigured: cfg !== null,
      tenantId: cfg?.tenantId ?? null,
      enabled: settings?.speStorageEnabled === true,
      containerTypeId: settings?.speContainerTypeId ?? null,
      containerIdDev: settings?.speContainerIdDev ?? null,
      containerIdProd: settings?.speContainerIdProd ?? null,
      activeBackend: process.env["STORAGE_BACKEND"] ?? "gcs",
      activeContainerSlot,
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
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
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
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
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
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
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
// POST /admin/integrations/spe/test-upload
// Round-trip validation: uploads a synthetic small file, reads it back,
// verifies bytes, deletes it. Lets an admin sanity-check that
// credentials, container, and Graph wiring are all working before
// trusting the cutover with real data. The test artifact is deleted on
// success; on partial failure (e.g. delete fails) the orphan-cleanup
// flow picks it up later.
// ---------------------------------------------------------------------------
router.post(
  "/admin/integrations/spe/test-upload",
  requireAdmin,
  async (req, res): Promise<void> => {
    let result;
    try {
      result = await speRoundTripTest();
    } catch (err) {
      req.log.error({ err }, "SPE round-trip test threw");
      res.status(502).json({ ok: false, error: (err as Error).message });
      return;
    }
    await audit({
      actorId: req.authedUser!.id,
      action: "spe.test.roundtrip",
      entity: "site_settings",
      entityId: String(SETTINGS_ID),
      diff: { itemId: result.itemId, ok: result.ok, timings: result.timings },
    });
    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// GET /admin/integrations/spe/orphans
// Compares files in the active SPE container against media.spe_file_id
// and reports anything that's been in the container >2h with no DB row.
// ---------------------------------------------------------------------------
router.get(
  "/admin/integrations/spe/orphans",
  requireAdmin,
  async (req, res): Promise<void> => {
    try {
      const result = await scanOrphans();
      res.json(result);
    } catch (err) {
      req.log.error({ err }, "SPE orphan scan failed");
      res.status(502).json({ error: (err as Error).message });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/integrations/spe/orphans/cleanup
// Deletes orphaned drive items from the active container. Defaults to
// dry-run; pass `dryRun: false` to actually delete. Optional `itemIds`
// limits the cleanup to a specific list (lets the admin UI show the
// sample, then delete just those).
// ---------------------------------------------------------------------------
const cleanupBody = z.object({
  dryRun: z.boolean().default(true),
  maxDelete: z.number().int().min(1).max(1000).default(100),
  itemIds: z.array(z.string().min(1)).max(1000).optional(),
});

router.post(
  "/admin/integrations/spe/orphans/cleanup",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = cleanupBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    let result;
    try {
      result = await cleanupOrphans(parsed.data);
    } catch (err) {
      req.log.error({ err }, "SPE orphan cleanup failed");
      res.status(502).json({ error: (err as Error).message });
      return;
    }
    await audit({
      actorId: req.authedUser!.id,
      action: parsed.data.dryRun ? "spe.orphan.cleanup.dryrun" : "spe.orphan.cleanup",
      entity: "site_settings",
      entityId: String(SETTINGS_ID),
      diff: {
        attempted: result.attempted,
        deleted: result.deleted,
        skipped: result.skipped,
        failures: result.failures.length,
      },
    });
    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// GET /admin/integrations/spe/migration-status
// Aggregate counts for the admin UI's Migration panel. Cheap — three
// indexed counts; safe to poll at human-scale intervals (every ~10s
// during a migration run).
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

// ---------------------------------------------------------------------------
// Migration job runner — in-memory state for background execution.
// Only one job runs at a time. The job state persists until the next
// run starts (safe to poll; survives HTTP request boundaries because
// it lives in the module-level closure, not the request lifecycle).
// ---------------------------------------------------------------------------
interface MigrationJob {
  status: "idle" | "running" | "completed" | "failed";
  dryRun: boolean;
  limit: number | null;
  startedAt: number | null;
  completedAt: number | null;
  processed: number;
  succeeded: number;
  failed: number;
  failures: Array<{ id: string; reason: string }>;
  error: string | null;
}

const migrationJob: MigrationJob = {
  status: "idle",
  dryRun: false,
  limit: null,
  startedAt: null,
  completedAt: null,
  processed: 0,
  succeeded: 0,
  failed: 0,
  failures: [],
  error: null,
};

// GET /admin/integrations/spe/migration/job — current job state
router.get("/admin/integrations/spe/migration/job", requireAdmin, (_req, res) => {
  res.json(migrationJob);
});

// POST /admin/integrations/spe/migration/run — start a background migration
const runMigrationBody = z.object({
  dryRun: z.boolean().default(false),
  limit: z.number().int().min(1).nullable().default(null),
});

router.post(
  "/admin/integrations/spe/migration/run",
  requireAdmin,
  async (req, res): Promise<void> => {
    if (migrationJob.status === "running") {
      res.json({ ok: true, already: true, job: migrationJob });
      return;
    }

    const parsed = runMigrationBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    const { dryRun, limit } = parsed.data;

    Object.assign(migrationJob, {
      status: "running",
      dryRun,
      limit,
      startedAt: Date.now(),
      completedAt: null,
      processed: 0,
      succeeded: 0,
      failed: 0,
      failures: [],
      error: null,
    });

    // Fire-and-forget — do NOT await; returns immediately so the HTTP
    // response is sent while the migration runs in the background.
    void runMigration({
      dryRun,
      limit,
      onRow: (_id, ok, detail) => {
        migrationJob.processed++;
        if (ok) {
          migrationJob.succeeded++;
        } else {
          migrationJob.failed++;
          // Cap stored failures to avoid unbounded memory growth.
          if (migrationJob.failures.length < 100) {
            migrationJob.failures.push({ id: _id, reason: detail });
          }
        }
      },
    })
      .then((result) => {
        Object.assign(migrationJob, {
          status: result.failed > 0 ? "failed" : "completed",
          completedAt: Date.now(),
          processed: result.processed,
          succeeded: result.succeeded,
          failed: result.failed,
          failures: result.failures.slice(0, 100),
        });
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof SpeNotEnabledError
            ? `SPE not configured: ${(err as Error).message}`
            : (err as Error).message;
        Object.assign(migrationJob, {
          status: "failed",
          completedAt: Date.now(),
          error: msg,
        });
      });

    await audit({
      actorId: req.authedUser!.id,
      action: dryRun ? "spe.migration.dryrun" : "spe.migration.run",
      entity: "site_settings",
      entityId: String(SETTINGS_ID),
      diff: { dryRun, limit },
    });

    res.json({ ok: true, started: true, job: migrationJob });
  },
);

export default router;
