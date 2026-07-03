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
import { BRIEFING_PODCAST_EMAIL_SUBJECT_PREFIX } from "../lib/email";
import { isAzureTtsConfigured, VALID_AZURE_VOICES } from "../lib/azureTts";
import { speFileStorage } from "../lib/storage/spe/fileStorage";
import {
  GraphMailClient,
  buildGraphMailConfig,
  isAutoReplyOrSystemMessage,
} from "../lib/storage/spe/graphMail";
import { readSpeGraphConfigFromEnv } from "../lib/storage/spe/graphClient";
import { refreshBriefingSubscription } from "../lib/briefingSubscriptionWorker";

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
  "/briefing-podcast/webhook",
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

  // Read the central delete-inbound toggle. Default false = leave messages in
  // the mailbox so admins can inspect them. Set to true in Site Settings when
  // ready to have the mailbox auto-cleaned after each delivery.
  const [settings] = await db
    .select({ briefingDeleteInbound: siteSettingsTable.briefingDeleteInbound })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  const shouldDelete = settings?.briefingDeleteInbound ?? false;

  if (shouldDelete) {
    await mail.deleteMessage(mailbox, messageId).catch((err) => {
      logger.warn({ err, messageId }, "Failed to delete inbound briefing message");
    });
  } else {
    logger.info(
      { messageId },
      "briefingDeleteInbound=false — inbound message left in mailbox",
    );
  }

  const sender = message.fromAddress;
  if (!sender) {
    logger.warn({ messageId }, "Inbound briefing had no sender; skipping");
    return;
  }

  // Approved-sender check comes first so that manual forwards from an
  // approved user (subject starts with Fw:) are always accepted.
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

  // The sender is on the approved allow-list (checked above) — our human-
  // curated trust boundary. Accept their briefings even when auto-forwarded or
  // redirected by an Exchange rule, which preserves the original briefing's
  // auto-generated headers (and produces no "Fwd:" subject prefix).
  //
  // We still drop genuine auto-REPLIES (out-of-office / vacation), auto-
  // notifications, and Exchange system messages (NDRs, read receipts) so they
  // can't loop back through the pipeline against our own delivery emails.
  if (isAutoReplyOrSystemMessage(message)) {
    logger.info(
      { sender, subject: message.subject, messageId },
      "Inbound briefing is an auto-reply/system message; discarded",
    );
    return;
  }

  // Reject our own podcast-delivery email if a recipient's broad forwarding /
  // redirect rule bounces it back into the watched mailbox. Without this, the
  // delivery email (sent from an approved sender's perspective) would be
  // re-ingested and re-podcasted, creating a feedback loop.
  // Strip any leading Re:/Fw:/Fwd: tokens a forwarding rule may prepend before
  // matching, so a bounced delivery email can't sneak past via "FW: Your
  // briefing podcast — …".
  const normalizedSubject = (message.subject ?? "")
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .toLowerCase();
  if (
    normalizedSubject.startsWith(
      BRIEFING_PODCAST_EMAIL_SUBJECT_PREFIX.toLowerCase(),
    )
  ) {
    logger.info(
      { sender, subject: message.subject, messageId },
      "Inbound message is our own podcast-delivery email; discarded to prevent loop",
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
    voiceOverride: client.voiceOverride ?? null,
  });
}

// ---------------------------------------------------------------------------
// Audio streaming proxy
// ---------------------------------------------------------------------------

router.get(
  "/briefing-podcast/:id/audio",
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

// Confirmation page shown by GET — safe for email scanner pre-fetches.
function purgeConfirmPage(token: string): string {
  const escaped = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Delete recording?</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#0b0b1a;color:#fff;">
<div style="max-width:480px;margin:80px auto;padding:32px;background:#fff;color:#1a1a2e;border-radius:12px;">
<h1 style="font-size:20px;color:#810FFB;">Delete this recording?</h1>
<p style="font-size:15px;line-height:1.6;">
  This will permanently remove the audio file from our server. You will no longer be able to listen to this briefing online.
</p>
<form method="POST" action="/api/briefing-podcast/purge">
  <input type="hidden" name="token" value="${escaped}" />
  <button type="submit" style="background:#810FFB;color:#fff;border:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;">
    Yes, delete the recording
  </button>
</form>
<p style="margin-top:16px;font-size:13px;color:#666;">Changed your mind? Just close this page — nothing will be deleted.</p>
</div></body></html>`;
}

// GET — show confirmation page only. Safe for email security pre-fetchers that
// follow every link in an email via GET; they will never submit a POST form.
router.get(
  "/briefing-podcast/purge",
  async (req: Request, res: Response) => {
    const token = typeof req.query["token"] === "string" ? req.query["token"] : null;
    const payload = verifyBriefingPurgeToken(token);
    if (!payload) {
      res.status(400).send(purgePage("Invalid link", "This purge link is not valid."));
      return;
    }
    const row = await db.query.briefingPodcastsTable.findFirst({
      where: eq(briefingPodcastsTable.id, payload.podcastId),
    });
    if (!row) {
      res.status(404).send(purgePage("Not found", "That recording no longer exists."));
      return;
    }
    if (row.status === "purged") {
      res.status(200).send(
        purgePage("Already removed", "This recording has already been purged from our server."),
      );
      return;
    }
    res.status(200).send(purgeConfirmPage(token!));
  },
);

// POST — performs the actual purge. Only reached when the user explicitly
// clicks "Yes, delete" on the confirmation page above.
router.post(
  "/briefing-podcast/purge",
  async (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? (req.body as { token: string }).token : null;
    const payload = verifyBriefingPurgeToken(token);
    if (!payload) {
      res.status(400).send(purgePage("Invalid link", "This purge link is not valid."));
      return;
    }
    const row = await db.query.briefingPodcastsTable.findFirst({
      where: eq(briefingPodcastsTable.id, payload.podcastId),
    });
    if (!row) {
      res.status(404).send(purgePage("Not found", "That recording no longer exists."));
      return;
    }
    if (row.status === "purged") {
      res.status(200).send(
        purgePage("Already removed", "This recording has already been purged from our server."),
      );
      return;
    }
    if (row.speItemId) {
      try {
        await speFileStorage.deleteFile(row.speItemId, row.speContainerId ?? undefined);
      } catch (err) {
        logger.error({ err, id: row.id }, "Failed to delete SPE briefing MP3");
        res.status(500).send(
          purgePage("Something went wrong", "We couldn't remove the recording right now. Please try again later."),
        );
        return;
      }
    }
    await db
      .update(briefingPodcastsTable)
      .set({ status: "purged", purgedAt: new Date() })
      .where(eq(briefingPodcastsTable.id, row.id));
    res.status(200).send(
      purgePage("Recording removed", "The audio version of your briefing has been permanently deleted from our server."),
    );
  },
);

// ---------------------------------------------------------------------------
// Admin allow-list CRUD + history
// ---------------------------------------------------------------------------

router.get(
  "/admin/briefing-podcast/clients",
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
  // Null / omitted = use global site_settings voice. Any valid voice string
  // from VALID_AZURE_VOICES or OPENAI_TTS_VOICES overrides for this client.
  voiceOverride: z.string().max(150).nullish(),
});

router.post(
  "/admin/briefing-podcast/clients",
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
    const voiceOverride = parsed.data.voiceOverride ?? null;
    const [row] = await db
      .insert(briefingPodcastClientsTable)
      .values({
        email,
        displayName: parsed.data.displayName ?? null,
        organizationLabel: parsed.data.organizationLabel ?? null,
        status: parsed.data.status ?? "approved",
        retainRecording,
        voiceOverride,
        approvedByUserId,
      })
      .onConflictDoUpdate({
        target: briefingPodcastClientsTable.email,
        set: {
          displayName: parsed.data.displayName ?? null,
          organizationLabel: parsed.data.organizationLabel ?? null,
          status: parsed.data.status ?? "approved",
          retainRecording,
          voiceOverride,
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
  voiceOverride: z.string().max(150).nullish(),
});

router.patch(
  "/admin/briefing-podcast/clients/:id",
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
    if (parsed.data.voiceOverride !== undefined)
      updates["voiceOverride"] = parsed.data.voiceOverride ?? null;
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
  "/admin/briefing-podcast/clients/:id",
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
  "/admin/briefing-podcast/history",
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
  "/admin/briefing-podcast/:id/purge",
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

const VALID_PODCAST_FORMATS = ["single", "dialogue"] as const;
const VALID_PODCAST_TONES   = ["formal", "conversational", "energetic"] as const;
const VALID_TTS_VOICES      = [
  "alloy", "ash", "coral", "echo", "fable",
  "nova", "onyx", "sage", "shimmer",
] as const;

function settingsSelect() {
  return {
    briefingMailbox:          siteSettingsTable.briefingMailbox,
    briefingDeleteInbound:    siteSettingsTable.briefingDeleteInbound,
    briefingPodcastFormat:    siteSettingsTable.briefingPodcastFormat,
    briefingPodcastTone:      siteSettingsTable.briefingPodcastTone,
    briefingPodcastVoice:     siteSettingsTable.briefingPodcastVoice,
    briefingPodcastHostVoice: siteSettingsTable.briefingPodcastHostVoice,
    briefingPodcastCohostVoice: siteSettingsTable.briefingPodcastCohostVoice,
    briefingPodcastAzureVoice:       siteSettingsTable.briefingPodcastAzureVoice,
    briefingPodcastAzureHostVoice:   siteSettingsTable.briefingPodcastAzureHostVoice,
    briefingPodcastAzureCohostVoice: siteSettingsTable.briefingPodcastAzureCohostVoice,
  } as const;
}

function settingsResponse(row: {
  briefingMailbox: string | null;
  briefingDeleteInbound: boolean;
  briefingPodcastFormat: string;
  briefingPodcastTone: string;
  briefingPodcastVoice: string;
  briefingPodcastHostVoice: string;
  briefingPodcastCohostVoice: string;
  briefingPodcastAzureVoice: string;
  briefingPodcastAzureHostVoice: string;
  briefingPodcastAzureCohostVoice: string;
} | undefined) {
  return {
    briefingMailbox:            row?.briefingMailbox          ?? null,
    briefingDeleteInbound:      row?.briefingDeleteInbound    ?? false,
    briefingPodcastFormat:      row?.briefingPodcastFormat    ?? "single",
    briefingPodcastTone:        row?.briefingPodcastTone      ?? "conversational",
    briefingPodcastVoice:       row?.briefingPodcastVoice     ?? "onyx",
    briefingPodcastHostVoice:   row?.briefingPodcastHostVoice ?? "onyx",
    briefingPodcastCohostVoice: row?.briefingPodcastCohostVoice ?? "nova",
    briefingPodcastAzureVoice:       row?.briefingPodcastAzureVoice       ?? "en-US-AndrewMultilingualNeural",
    briefingPodcastAzureHostVoice:   row?.briefingPodcastAzureHostVoice   ?? "en-US-AndrewMultilingualNeural",
    briefingPodcastAzureCohostVoice: row?.briefingPodcastAzureCohostVoice ?? "en-US-AvaMultilingualNeural",
    // Which TTS engine will actually be used for the next briefing. Azure is
    // primary when configured; otherwise gpt-audio (OpenAI) is the fallback.
    // The admin UI uses this to show the relevant voice picker.
    ttsEngine: isAzureTtsConfigured() ? ("azure" as const) : ("openai" as const),
  };
}

router.get(
  "/admin/briefing-podcast/settings",
  requireAuth,
  requireManage,
  async (_req: Request, res: Response) => {
    const [row] = await db
      .select(settingsSelect())
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID))
      .limit(1);
    res.json(settingsResponse(row));
  },
);

const BriefingSettingsBody = z.object({
  briefingMailbox:            z.string().email().max(320).nullable().optional(),
  briefingDeleteInbound:      z.boolean().optional(),
  briefingPodcastFormat:      z.enum(VALID_PODCAST_FORMATS).optional(),
  briefingPodcastTone:        z.enum(VALID_PODCAST_TONES).optional(),
  briefingPodcastVoice:       z.enum(VALID_TTS_VOICES).optional(),
  briefingPodcastHostVoice:   z.enum(VALID_TTS_VOICES).optional(),
  briefingPodcastCohostVoice: z.enum(VALID_TTS_VOICES).optional(),
  briefingPodcastAzureVoice:       z.enum(VALID_AZURE_VOICES).optional(),
  briefingPodcastAzureHostVoice:   z.enum(VALID_AZURE_VOICES).optional(),
  briefingPodcastAzureCohostVoice: z.enum(VALID_AZURE_VOICES).optional(),
});

router.patch(
  "/admin/briefing-podcast/settings",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const parsed = BriefingSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const updates: Record<string, unknown> = {};
    if (d.briefingMailbox            !== undefined) updates["briefingMailbox"]            = d.briefingMailbox;
    if (d.briefingDeleteInbound      !== undefined) updates["briefingDeleteInbound"]      = d.briefingDeleteInbound;
    if (d.briefingPodcastFormat      !== undefined) updates["briefingPodcastFormat"]      = d.briefingPodcastFormat;
    if (d.briefingPodcastTone        !== undefined) updates["briefingPodcastTone"]        = d.briefingPodcastTone;
    if (d.briefingPodcastVoice       !== undefined) updates["briefingPodcastVoice"]       = d.briefingPodcastVoice;
    if (d.briefingPodcastHostVoice   !== undefined) updates["briefingPodcastHostVoice"]   = d.briefingPodcastHostVoice;
    if (d.briefingPodcastCohostVoice !== undefined) updates["briefingPodcastCohostVoice"] = d.briefingPodcastCohostVoice;
    if (d.briefingPodcastAzureVoice       !== undefined) updates["briefingPodcastAzureVoice"]       = d.briefingPodcastAzureVoice;
    if (d.briefingPodcastAzureHostVoice   !== undefined) updates["briefingPodcastAzureHostVoice"]   = d.briefingPodcastAzureHostVoice;
    if (d.briefingPodcastAzureCohostVoice !== undefined) updates["briefingPodcastAzureCohostVoice"] = d.briefingPodcastAzureCohostVoice;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "no_fields" });
      return;
    }
    await db
      .update(siteSettingsTable)
      .set(updates)
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID));
    const [row] = await db
      .select(settingsSelect())
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID))
      .limit(1);
    res.json(settingsResponse(row));
    // If the watched mailbox changed, immediately re-check the Graph subscription
    // so the new address starts receiving notifications without waiting for the
    // next hourly tick.
    if (d.briefingMailbox !== undefined) {
      void refreshBriefingSubscription().catch((err) =>
        logger.error({ err }, "Background subscription refresh after mailbox change failed"),
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Voice preview — synthesise a short sample clip for a given voice
// ---------------------------------------------------------------------------

const PREVIEW_SAMPLE = "Good morning. Here is today's executive briefing.";

const PreviewVoiceBody = z.object({
  voice: z.string().min(1).max(150),
});

router.post(
  "/admin/briefing-podcast/preview-voice",
  requireAuth,
  requireManage,
  async (req: Request, res: Response) => {
    const parsed = PreviewVoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { voice } = parsed.data;

    // Validate the voice belongs to whichever engine is active.
    const useAzure = isAzureTtsConfigured();
    if (useAzure) {
      if (!(VALID_AZURE_VOICES as readonly string[]).includes(voice)) {
        res.status(400).json({ error: "invalid_azure_voice" });
        return;
      }
    } else {
      if (!(VALID_TTS_VOICES as readonly string[]).includes(voice)) {
        res.status(400).json({ error: "invalid_openai_voice" });
        return;
      }
    }

    try {
      let audioBuffer: Buffer;
      if (useAzure) {
        const { azureSynthesizeChunk } = await import("../lib/azureTts");
        audioBuffer = await azureSynthesizeChunk(PREVIEW_SAMPLE, voice);
      } else {
        const { synthesizeSpeech } = await import("../lib/tts");
        const result = await synthesizeSpeech(PREVIEW_SAMPLE, {
          format: "single",
          tone: "conversational",
          voice,
          hostVoice: voice,
          cohostVoice: voice,
        });
        audioBuffer = result.audio;
      }
      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Length", String(audioBuffer.length));
      res.set("Cache-Control", "no-store");
      res.status(200).send(audioBuffer);
    } catch (err) {
      logger.error({ err, voice }, "Voice preview synthesis failed");
      res.status(500).json({ error: "synthesis_failed" });
    }
  },
);

// ---------------------------------------------------------------------------
// Admin subscription status + manual refresh
// ---------------------------------------------------------------------------

router.get(
  "/admin/briefing-podcast/subscription/status",
  requireAuth,
  requireManage,
  async (_req: Request, res: Response) => {
    if (!readSpeGraphConfigFromEnv()) {
      res.json({ configured: false, reason: "Graph credentials not set" });
      return;
    }
    const [settings] = await db
      .select({ briefingMailbox: siteSettingsTable.briefingMailbox })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID))
      .limit(1);
    const mailbox = settings?.briefingMailbox;
    if (!mailbox) {
      res.json({ configured: false, reason: "No mailbox configured" });
      return;
    }
    try {
      const cfg = buildGraphMailConfig(mailbox);
      const client = new GraphMailClient();
      const subs = await client.listSubscriptions();
      const active = subs.find((s) => s.notificationUrl === cfg.notificationUrl);
      res.json({
        configured: true,
        mailbox,
        active: !!active,
        subscriptionId: active?.id ?? null,
        expiresAt: active?.expirationDateTime ?? null,
      });
    } catch (err) {
      logger.error({ err }, "Failed to query Graph subscription status");
      res.status(500).json({ error: "Failed to query Graph subscriptions" });
    }
  },
);

// Force an immediate subscription check — useful after approving a new mailbox,
// recovering from a lapsed subscription, or any time the admin suspects the
// listener has stopped working.
router.post(
  "/admin/briefing-podcast/subscription/refresh",
  requireAuth,
  requireManage,
  async (_req: Request, res: Response) => {
    try {
      await refreshBriefingSubscription();
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Manual subscription refresh failed");
      res.status(500).json({ error: "Refresh failed" });
    }
  },
);

export default router;
