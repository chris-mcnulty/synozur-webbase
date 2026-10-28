import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db, hubspotSyncEventsTable, siteSettingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { audit } from "../lib/audit";
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
  // Count timeline events that were skipped due to missing timeline app id.
  const [skippedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hubspotSyncEventsTable)
    .where(
      and(
        eq(hubspotSyncEventsTable.status, "skipped"),
        eq(hubspotSyncEventsTable.lastError, "no_timeline_app_id"),
      ),
    );
  const skippedTimelineCount = skippedRow?.count ?? 0;
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
  // #549 — Tracking + Forms-API stitching configuration health.
  // Which env vars are present so admins can see at a glance what needs
  // to be set before the tracking pixel and per-form stitching will fire.
  const FORM_TYPES_FOR_STITCHING = [
    "contact", "subscribe", "start", "white-paper", "webinar", "partner", "demo",
  ] as const;
  const portalId = (probe.ok && probe.portalId)
    ? String(probe.portalId)
    : (process.env["HUBSPOT_PORTAL_ID"] ?? null);
  const trackingConfig = {
    portalIdConfigured: !!portalId,
    trackingScriptReady: !!portalId,
    formGuids: Object.fromEntries(
      FORM_TYPES_FOR_STITCHING.map((ft) => {
        const key = `HUBSPOT_FORM_GUID_${ft.toUpperCase().replace(/-/g, "_")}`;
        return [ft, !!(process.env[key] && (process.env[key] as string).length > 0)];
      }),
    ),
    setupNote: "Create one HubSpot form per form-type in your portal, then set "
      + "HUBSPOT_FORM_GUID_<FORM_TYPE> (e.g. HUBSPOT_FORM_GUID_CONTACT) in the "
      + "environment. Set HUBSPOT_PORTAL_ID to enable the tracking pixel and "
      + "all stitching submissions.",
  };
  res.json({
    configured,
    tokenSource,
    enabled: settings?.hubspotEnabled === true,
    portalId,
    connection: probe,
    timelineAppId: settings?.hubspotTimelineAppId ?? null,
    formToggles: settings?.hubspotFormToggles ?? null,
    lifecycleMappings: settings?.hubspotLifecycleMappings ?? null,
    euOptInDefault: settings?.hubspotEuOptInDefault ?? false,
    queue: depth,
    skippedTimelineCount,
    freshness,
    trackingConfig,
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

// Reset all timeline events that were skipped due to a missing app id back to
// pending so the worker picks them up once the app id is configured.
router.post("/admin/integrations/hubspot/retry-skipped", requireAdmin, async (req, res): Promise<void> => {
  const updated = await db
    .update(hubspotSyncEventsTable)
    .set({ status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date() })
    .where(
      and(
        eq(hubspotSyncEventsTable.status, "skipped"),
        eq(hubspotSyncEventsTable.lastError, "no_timeline_app_id"),
      ),
    )
    .returning({ id: hubspotSyncEventsTable.id });
  const count = updated.length;
  const actor = (req as unknown as { user?: { id?: string } }).user?.id ?? null;
  await audit({
    actorId: actor,
    action: "retry_skipped_timeline_events",
    entity: "hubspot_sync_events",
    diff: { reset: count },
  });
  res.json({ ok: true, reset: count });
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
    const raw = String(req.params.submissionId ?? "");
    const submissionId = parseInt(raw, 10);
    if (!raw || isNaN(submissionId)) {
      res.status(400).json({ error: "Missing or invalid submissionId (must be a number)" });
      return;
    }
    const ok = await forceResyncSubmission(submissionId);
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
