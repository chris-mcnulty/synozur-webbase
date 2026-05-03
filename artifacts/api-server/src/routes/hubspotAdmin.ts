import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, hubspotSyncEventsTable, siteSettingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  drainHubspotQueue,
  eraseContact,
  forceResyncSubmission,
  isHubspotConfigured,
  lastSyncTimestamps,
  probeHubspotConnection,
  queueDepth,
  replayDeadLetter,
} from "../lib/hubspotSync";

// #131: admin surface for the HubSpot integration. The token + portal id stay
// in env (rotated outside the app) — this surface owns the runtime knobs:
// enable/disable, per-form-type toggles, lifecycle mappings, queue health,
// replay, and GDPR erasure.

const router: IRouter = Router();

router.get("/admin/integrations/hubspot/status", requireAdmin, async (_req, res): Promise<void> => {
  const configured = await isHubspotConfigured();
  const settings = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.id, 1),
  });
  const depth = await queueDepth();
  // Live HubSpot connection probe + per-object freshness so the admin
  // health card can show "connected, last contact synced 4m ago, last
  // timeline event 12m ago" without a separate request.
  const probe = await probeHubspotConnection();
  const freshness = await lastSyncTimestamps();
  const recent = await db
    .select()
    .from(hubspotSyncEventsTable)
    .orderBy(desc(hubspotSyncEventsTable.createdAt))
    .limit(25);
  // Discriminate the token source so admins can tell at a glance whether
  // we're reading from Replit Connections or a static env var.
  const tokenSource = process.env["REPLIT_CONNECTORS_HOSTNAME"]
    ? "replit-connections"
    : process.env["HUBSPOT_ACCESS_TOKEN"]
      ? "env"
      : "none";
  res.json({
    configured,
    tokenSource,
    enabled: settings?.hubspotEnabled === true,
    portalId: probe.ok && probe.portalId ? probe.portalId : process.env["HUBSPOT_PORTAL_ID"] ?? null,
    connection: probe,
    timelineAppId: settings?.hubspotTimelineAppId ?? null,
    formToggles: settings?.hubspotFormToggles ?? null,
    lifecycleMappings: settings?.hubspotLifecycleMappings ?? null,
    euOptInDefault: settings?.hubspotEuOptInDefault ?? false,
    queue: depth,
    freshness,
    recentEvents: recent.map((r) => {
      // Pull `submissionId` out of the persisted payload so the admin
      // UI can offer a per-row "force re-sync" action without an extra
      // round trip per row.
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const submissionId = typeof payload["submissionId"] === "number"
        ? (payload["submissionId"] as number)
        : null;
      return {
        id: r.id,
        kind: r.kind,
        contactEmail: r.contactEmail,
        status: r.status,
        attempts: r.attempts,
        lastError: r.lastError,
        hubspotResourceId: r.hubspotResourceId,
        nextAttemptAt: r.nextAttemptAt,
        createdAt: r.createdAt,
        succeededAt: r.succeededAt,
        submissionId,
      };
    }),
  });
});

const SettingsBody = z.object({
  enabled: z.boolean().optional(),
  timelineAppId: z.string().nullish(),
  euOptInDefault: z.boolean().optional(),
  formToggles: z.record(z.string(), z.boolean()).optional(),
  lifecycleMappings: z.record(z.string(), z.string()).optional(),
});

router.patch("/admin/integrations/hubspot/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = SettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const upd: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) upd["hubspotEnabled"] = parsed.data.enabled;
  if (parsed.data.timelineAppId !== undefined) upd["hubspotTimelineAppId"] = parsed.data.timelineAppId;
  if (parsed.data.euOptInDefault !== undefined) upd["hubspotEuOptInDefault"] = parsed.data.euOptInDefault;
  if (parsed.data.formToggles !== undefined) upd["hubspotFormToggles"] = parsed.data.formToggles;
  if (parsed.data.lifecycleMappings !== undefined) upd["hubspotLifecycleMappings"] = parsed.data.lifecycleMappings;
  // Ensure the singleton row exists.
  await db.insert(siteSettingsTable).values({ id: 1, ...upd }).onConflictDoUpdate({
    target: siteSettingsTable.id,
    set: upd,
  });
  res.json({ ok: true });
});

router.post("/admin/integrations/hubspot/drain", requireAdmin, async (_req, res): Promise<void> => {
  const result = await drainHubspotQueue(50);
  res.json({ ok: true, processed: result.processed });
});

// Per-submission force-resync. Re-enqueues a fresh `contact.upsert` for
// the targeted form_submission so an operator can recover a single row
// without re-running the full backfill script.
router.post(
  "/admin/integrations/hubspot/resync/:submissionId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.submissionId ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid submissionId" });
      return;
    }
    const ok = await forceResyncSubmission(id);
    if (!ok) {
      res.status(404).json({ error: "Submission not found or has no email" });
      return;
    }
    res.json({ ok: true });
  },
);

router.post("/admin/integrations/hubspot/replay/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const ok = await replayDeadLetter(id);
  if (!ok) {
    res.status(404).json({ error: "Not found or not in dead_letter" });
    return;
  }
  res.json({ ok: true });
});

const ErasureBody = z.object({
  email: z.string().email(),
});

router.post("/admin/integrations/hubspot/erasure", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ErasureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const result = await eraseContact(parsed.data.email);
  if (!result.ok) {
    res.status(502).json({ error: result.error ?? "erasure_failed" });
    return;
  }
  res.json({ ok: true });
});

export default router;
