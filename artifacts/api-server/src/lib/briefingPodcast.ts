import { eq } from "drizzle-orm";
import { db, briefingPodcastsTable, siteSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import {
  briefingHtmlToScript,
  synthesizeSpeech,
  DEFAULT_PODCAST_CONFIG,
  type PodcastConfig,
} from "./tts";
import { speFileStorage } from "./storage/spe/fileStorage";
import { signBriefingPurgeToken } from "./briefingPurgeToken";
import { sendBriefingPodcastEmail } from "./email";

const SITE_URL = (process.env["SITE_URL"] ?? "https://synozur.com").replace(
  /\/$/,
  "",
);
const SETTINGS_ROW_ID = 1;

export type BriefingSource = "client";

export interface ProcessBriefingArgs {
  html: string;
  subject: string;
  recipientEmail: string;
  recipientName: string | null;
  source: BriefingSource;
  // When true: store MP3 in SPE, deliver streaming URL + purge link in email.
  // When false: attach MP3 directly to email then delete from SPE immediately.
  retainRecording: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sec`;
  return `${m} min${s >= 30 ? " 30 sec" : ""}`;
}

// Full pipeline: HTML briefing -> narration script -> MP3 -> SPE -> email.
// Records a `briefing_podcasts` row throughout so the admin history view and
// the purge endpoint can find the audio. Returns the row id.
export async function processBriefing(
  args: ProcessBriefingArgs,
): Promise<string> {
  logger.info(
    { recipient: args.recipientEmail, subject: args.subject, htmlLength: (args.html ?? "").length },
    "processBriefing: starting",
  );
  const [row] = await db
    .insert(briefingPodcastsTable)
    .values({
      recipientEmail: args.recipientEmail,
      source: args.source,
      subject: args.subject,
      status: "processing",
    })
    .returning({ id: briefingPodcastsTable.id });
  const podcastId = row!.id;

  try {
    // Read podcast style config from site_settings.
    const [settingsRow] = await db
      .select({
        briefingPodcastFormat:      siteSettingsTable.briefingPodcastFormat,
        briefingPodcastTone:        siteSettingsTable.briefingPodcastTone,
        briefingPodcastVoice:       siteSettingsTable.briefingPodcastVoice,
        briefingPodcastHostVoice:   siteSettingsTable.briefingPodcastHostVoice,
        briefingPodcastCohostVoice: siteSettingsTable.briefingPodcastCohostVoice,
      })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID))
      .limit(1);

    const podcastConfig: PodcastConfig = {
      format:      (settingsRow?.briefingPodcastFormat ?? "single") as PodcastConfig["format"],
      tone:        (settingsRow?.briefingPodcastTone ?? "conversational") as PodcastConfig["tone"],
      voice:       settingsRow?.briefingPodcastVoice      ?? DEFAULT_PODCAST_CONFIG.voice,
      hostVoice:   settingsRow?.briefingPodcastHostVoice  ?? DEFAULT_PODCAST_CONFIG.hostVoice,
      cohostVoice: settingsRow?.briefingPodcastCohostVoice ?? DEFAULT_PODCAST_CONFIG.cohostVoice,
    };

    const script = await briefingHtmlToScript(args.html, podcastConfig);
    if (!script.trim()) {
      throw new Error("Briefing produced an empty script");
    }
    logger.info(
      { podcastId, scriptLength: script.length },
      "processBriefing: script ready, starting TTS",
    );
    const { audio, estimatedDurationSeconds } = await synthesizeSpeech(script, podcastConfig);

    const filename = `briefing-${new Date().toISOString().slice(0, 10)}-${podcastId.slice(0, 8)}.mp3`;
    const stored = await speFileStorage.storeFile({
      body: audio,
      filename,
      contentType: "audio/mpeg",
      documentType: "briefing",
      ownerId: podcastId,
      extraFields: { SynozurDocumentType: "briefing" },
    });

    let emailResult;
    if (args.retainRecording) {
      // Keep MP3 in SPE — deliver streaming URL + purge link.
      await db
        .update(briefingPodcastsTable)
        .set({
          status: "delivered",
          speContainerId: stored.containerId,
          speItemId: stored.itemId,
          durationSeconds: estimatedDurationSeconds,
          byteSize: audio.length,
        })
        .where(eq(briefingPodcastsTable.id, podcastId));

      const audioUrl = `${SITE_URL}/api/briefing-podcast/${podcastId}/audio`;
      const purgeUrl = `${SITE_URL}/api/briefing-podcast/purge?token=${encodeURIComponent(
        signBriefingPurgeToken(podcastId),
      )}`;

      emailResult = await sendBriefingPodcastEmail({
        to: args.recipientEmail,
        recipientName: args.recipientName,
        briefingSubject: args.subject,
        audioUrl,
        purgeUrl,
        durationLabel: formatDuration(estimatedDurationSeconds),
      });
    } else {
      // Attach MP3 to email then delete from SPE — nothing retained on server.
      emailResult = await sendBriefingPodcastEmail({
        to: args.recipientEmail,
        recipientName: args.recipientName,
        briefingSubject: args.subject,
        audioUrl: null,
        purgeUrl: null,
        durationLabel: formatDuration(estimatedDurationSeconds),
        attachmentBuffer: audio,
        attachmentFilename: filename,
      });

      // Delete from SPE immediately after the email is dispatched.
      await speFileStorage
        .deleteFile(stored.itemId, stored.containerId)
        .catch((err) =>
          logger.error(
            { err, podcastId },
            "Failed to delete SPE MP3 after attachment send",
          ),
        );

      await db
        .update(briefingPodcastsTable)
        .set({
          status: "purged",
          purgedAt: new Date(),
          durationSeconds: estimatedDurationSeconds,
          byteSize: audio.length,
        })
        .where(eq(briefingPodcastsTable.id, podcastId));
    }

    if (emailResult.status === "error") {
      await db
        .update(briefingPodcastsTable)
        .set({ status: "failed", error: `email: ${(emailResult.error ?? "unknown").slice(0, 1000)}` })
        .where(eq(briefingPodcastsTable.id, podcastId));
      logger.warn(
        { podcastId, err: emailResult.error },
        "Briefing podcast generated but delivery email failed",
      );
      return podcastId;
    }
    logger.info(
      { podcastId, recipient: args.recipientEmail, bytes: audio.length, retainRecording: args.retainRecording },
      "Briefing podcast delivered",
    );
    return podcastId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(briefingPodcastsTable)
      .set({ status: "failed", error: message.slice(0, 1000) })
      .where(eq(briefingPodcastsTable.id, podcastId));
    logger.error({ err, podcastId }, "Briefing podcast pipeline failed");
    throw err;
  }
}
