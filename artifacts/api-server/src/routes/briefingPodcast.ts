import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import {
  db,
  briefingPodcastClientsTable,
  briefingPodcastsTable,
  siteSettingsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth, requireCapability } from "../middlewares/auth";
import { verifyBriefingPurgeToken } from "../lib/briefingPurgeToken";
import { processBriefing } from "../lib/briefingPodcast";
import { speFileStorage } from "../lib/storage/spe/fileStorage";
import {
  GraphMailClient,
  buildGraphMailConfig,
  isDirectInboundEmail,
} from "../lib/storage/spe/graphMail";

// Briefing Podcast routes.
//
//   POST /api/briefing-podcast/webhook      — Graph change-notification receiver
//   GET  /api/briefing-podcast/:id/audio    — streaming MP3 proxy from SPE
//   GET  /api/briefing-podcast/purge        — one-click signed purge link
//   /api/admin/briefing-podcast/*           — allow-list CRUD + history (admin)
//   GET/PATCH /api/admin/briefing-podcast/settings — mailbox config
//
// Reuses the SharePoint Embedded `client_orgs.manage` capability for the
// admin surface — already granted to admin / site_admin / account_manager.

const router: IRouter = Router();
const requireManage = requireCapability("client_orgs.manage");

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Read the watched mailbox from site_settings (null → feature inactive).
async function getWatchedMailbox(): Promise<string | null> {
  const [row] = await db
    .select({ briefingMailbox: siteSettingsTable.briefingMailbox })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1))
    .limit(1);
  return row?.briefingMailbox ?? null;
}

// ---------------------------------------------------------------------------
// Graph change-notification webhook
// ---------------------------------------------------------------------------

router.post(
  "/api/briefing-podcast/webhook",
  async (req: Request, res: Response) => {
    // Subscription validation handshake: Graph POSTs with ?validationToken
    // and expects a 200 echoing the token as text/plain within 10s.
    const validationToken = req.query["validationToken"];
    if (typeof validationToken === "string") {
      res.set("Content-Type", "text/plain").status(200).send(validationToken);
      return;
    }

    const mailbox = await getWatchedMailbox();
    if (!mailbox) {
      logger.warn("Briefing webhook hit but no mailbox configured");
      res.status(202).end();
      return;
    }

    const notifications: unknown = (req.body as { value?: unknown[] })?.value;
    if (!Array.isArray(notifications)) {
      res.status(202).end();
      return;
    }

    // Acknowledge fast; do the slow work (fetch/delete/TTS/email) async.
    res.status(202).end();

    const cfg = buildGraphMailConfig(mailbox);
    for (const raw of notifications) {
      const note = raw as {
        clientState?: string;
        resourceData?: { id?: string };
      };
      if (note.clientState !== cfg.clientState) {
        logger.warn("Briefing webhook notification with bad clientState");
        continue;
      }
      const messageId = note.resourceData?.id;
      if (!messageId) continue;
      void handleInboundMessage(mailbox, messageId).catch((err) => {
        logger.error({ err, messageId }, "Briefing inbound handling failed");
      });
    }
  },
);

async function handleInboundMessage(
  mailbox: string,
  messageId: string,
): Promise<void> {
  const mail = new GraphMailClient();
  const message = await mail.getMessage(mailbox, messageId);

  // Always delete the inbound message first — even filtered ones — so the
  // mailbox stays clean regardless of outcome.
  await mail.deleteMessage(mailbox, messageId).catch((err) => {
    logger.warn({ err, messageId }, "Failed to delete inbound briefing message");
  });

  const sender = message.fromAddress;
  if (!sender) {
    logger.warn({ messageId }, "Inbound briefing had no sender; skipping");
    return;
  }

  // Drop replies, forwards, auto-replies, OOF notices, NDRs, etc.
  // This prevents a delivery-confirmation or vacation reply from looping back
  // through the podcast pipeline and generating a new audio file.
  if (!isDirectInboundEmail(message)) {
    logger.info(
      { sender, subject: message.subject, messageId },
      "Inbound briefing message filtered out (reply / forward / auto-reply); discarded",
    );
    return;
  }

  const client = await db.query.briefingPodcastClientsTable.findFirst({
    where: eq(briefingPodcastClientsTable.email, sender),
  });
  if (!client || client.status !== "approved") {
    logger.info(
      { sender, messageId },
      "Inbound briefing from non-approved sender; ignored",
    );
    return;
  }

  await processBriefing({
    html: message.bodyHtml,
    subject: message.subject,
    recipientEmail: sender,
    recipientName: client.displayName ?? message.fromName,
    source: "client",
    retainRecording: client.retainRecording,
  });
}

// ---------------------------------------------------------------------------
// Audio streaming proxy
// ---------------------------------------------------------------------------

router.get(
  "/api/briefing-podcast/:id/audio",
  async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!id) {
      res.status(400).send("Missing id");
      return;
    }
    const row = await db.query.briefingPodcastsTable.findFirst({
      where: eq(briefingPodcastsTable.id, id),
    });
    if (!row || !row.speItemId || row.status === "purged") {
      res.status(404).send("Recording not found");
      return;
    }
    try {
      const upstream = await speFileStorage.getFile(
        row.speItemId,
        row.speContainerId ?? undefined,
      );
      if (!upstream.ok || !upstream.body) {
        res.status(502).send("Failed to fetch recording");
        return;
      }
      res.set("Content-Type", "audio/mpeg");
      if (row.byteSize) res.set("Content-Length", String(row.byteSize));
      res.set(
        "Content-Disposition",
        `inline; filename="briefing-${id.slice(0, 8)}.mp3"`,
      );
      // Stream the Web ReadableStream body to the Express response.
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          const ok = res.write(chunk);
          if (!ok) await new Promise<void>((r) => res.once("drain", r));
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } catch (err) {
      logger.error({ err, id }, "Briefing audio proxy failed");
      if (!res.headersSent) res.status(500).send("Error streaming recording");
    }
  },
);

// ---------------------------------------------------------------------------
// One-click purge
// ---------------------------------------------------------------------------

function purgePage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#0b0b1a;color:#fff;">
<div style="max-width:480px;margin:80px auto;padding:32px;background:#fff;color:#1a1a2e;border-radius:12px;">
<h1 style="font-size:20px;color:#810FFB;">${title}</h1>
<p style="font-size:15px;line-height:1.6;">${message}</p>
</div></body></html>`;
}

router.get(
  "/api/briefing-podcast/purge",
  async (req: Request, res: Response) => {
    const token = typeof req.query["token"] === "string" ? req.query["token"] : null;
    const payload = verifyBriefingPurgeToken(token);
    if (!payload) {
      res
        .status(400)
        .send(purgePage("Invalid link", "This purge link is not valid."));
      return;
    }
    const row = await db.query.briefingPodcastsTable.findFirst({
      where: eq(briefingPodcastsTable.id, payload.podcastId),
    });
    if (!row) {
      res
        .status(404)
        .send(purgePage("Not found", "That recording no longer exists."));
      return;
    }
    if (row.status === "purged") {
      res
        .status(200)
        .send(
          purgePage(
            "Already removed",
            "This recording has already been purged from our server.",
          ),
        );
      return;
    }
    if (row.speItemId) {
      try {
        await speFileStorage.deleteFile(
          row.speItemId,
          row.speContainerId ?? undefined,
        );
      } catch (err) {
        logger.error({ err, id: row.id }, "Failed to delete SPE briefing MP3");
        res
          .status(500)
          .send(
            purgePage(
              "Something went wrong",
              "We couldn't remove the recording right now. Please try again later.",
            ),
          );
        return;
      }
    }
    await db
      .update(briefingPodcastsTable)
      .set({ status: "purged", purgedAt: new Date() })
      .where(eq(briefingPodcastsTable.id, row.id));
    res
      .status(200)
      .send(
        purgePage(
          "Recording removed",
          "The audio version of your briefing has been permanently deleted from our server.",
        ),
      );
  },
);

// ---------------------------------------------------------------------------
// Admin allow-list CRUD + history
// ---------------------------------------------------------------------------

router.get(
  "/api/admin/briefing-podcast/clients",
  requireAuth,
  requireManage,
  async (_req: Request, res: Response) => {
    const clients = await db
      .select()
      .from(briefingPodcastClientsTable)
      .orderBy(desc(briefingPodcastClientsTable.approvedAt));
    res.json({ clients });
  },
);

const UpsertClientBody = z.object({
  email: z.string().email().max(320),
  displayName: z.string().max(255).nullish(),
  organizationLabel: z.string().max(255).nullish(),
  status: z.enum(["approved", "revoked"]).optional(),
  retainRecording: z.boolean().optional(),
});

router.post(
  "/api/admin/briefing-podcast/clients",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const parsed = UpsertClientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const email = normalizeEmail(parsed.data.email);
    const approvedByUserId = req.authedUser?.id ?? null;
    const retainRecording = parsed.data.retainRecording ?? true;
    const [row] = await db
      .insert(briefingPodcastClientsTable)
      .values({
        email,
        displayName: parsed.data.displayName ?? null,
        organizationLabel: parsed.data.organizationLabel ?? null,
        status: parsed.data.status ?? "approved",
        retainRecording,
        approvedByUserId,
      })
      .onConflictDoUpdate({
        target: briefingPodcastClientsTable.email,
        set: {
          displayName: parsed.data.displayName ?? null,
          organizationLabel: parsed.data.organizationLabel ?? null,
          status: parsed.data.status ?? "approved",
          retainRecording,
          approvedByUserId,
          updatedAt: new Date(),
        },
      })
      .returning();
    res.status(201).json({ client: row });
  },
);

// Partial update — only updates the fields explicitly provided.
// Used by the UI toggle (retainRecording) so a one-field change never
// overwrites displayName/status/etc. with defaults.
const PatchClientBody = z.object({
  displayName: z.string().max(255).nullish(),
  organizationLabel: z.string().max(255).nullish(),
  status: z.enum(["approved", "revoked"]).optional(),
  retainRecording: z.boolean().optional(),
});

router.patch(
  "/api/admin/briefing-podcast/clients/:id",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!id) {
      res.status(400).json({ error: "missing_id" });
      return;
    }
    const parsed = PatchClientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.displayName !== undefined)
      updates["displayName"] = parsed.data.displayName ?? null;
    if (parsed.data.organizationLabel !== undefined)
      updates["organizationLabel"] = parsed.data.organizationLabel ?? null;
    if (parsed.data.status !== undefined) updates["status"] = parsed.data.status;
    if (parsed.data.retainRecording !== undefined)
      updates["retainRecording"] = parsed.data.retainRecording;
    const [row] = await db
      .update(briefingPodcastClientsTable)
      .set(updates)
      .where(eq(briefingPodcastClientsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ client: row });
  },
);

router.delete(
  "/api/admin/briefing-podcast/clients/:id",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!id) {
      res.status(400).json({ error: "missing_id" });
      return;
    }
    await db
      .delete(briefingPodcastClientsTable)
      .where(eq(briefingPodcastClientsTable.id, id));
    res.status(204).end();
  },
);

router.get(
  "/api/admin/briefing-podcast/history",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query["limit"]) || 50, 200);
    const rows = await db
      .select()
      .from(briefingPodcastsTable)
      .orderBy(desc(briefingPodcastsTable.createdAt))
      .limit(limit);
    res.json({ podcasts: rows });
  },
);

// Manual purge from the admin history view.
router.post(
  "/api/admin/briefing-podcast/:id/purge",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!id) {
      res.status(400).json({ error: "missing_id" });
      return;
    }
    const row = await db.query.briefingPodcastsTable.findFirst({
      where: eq(briefingPodcastsTable.id, id),
    });
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (row.status !== "purged" && row.speItemId) {
      await speFileStorage
        .deleteFile(row.speItemId, row.speContainerId ?? undefined)
        .catch((err) =>
          logger.error({ err, id }, "Admin purge SPE delete failed"),
        );
    }
    await db
      .update(briefingPodcastsTable)
      .set({ status: "purged", purgedAt: new Date() })
      .where(eq(briefingPodcastsTable.id, id));
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Briefing settings (watched mailbox)
// ---------------------------------------------------------------------------

const SETTINGS_ROW_ID = 1;

router.get(
  "/api/admin/briefing-podcast/settings",
  requireAuth,
  requireManage,
  async (_req: Request, res: Response) => {
    const [row] = await db
      .select({ briefingMailbox: siteSettingsTable.briefingMailbox })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID))
      .limit(1);
    res.json({ briefingMailbox: row?.briefingMailbox ?? null });
  },
);

const BriefingSettingsBody = z.object({
  briefingMailbox: z.string().email().max(320).nullable(),
});

router.patch(
  "/api/admin/briefing-podcast/settings",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const parsed = BriefingSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await db
      .update(siteSettingsTable)
      .set({ briefingMailbox: parsed.data.briefingMailbox })
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID));
    res.json({ briefingMailbox: parsed.data.briefingMailbox });
  },
);

export default router;
