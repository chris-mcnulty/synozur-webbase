import { eq } from "drizzle-orm";
import { db, briefingPodcastsTable } from "@workspace/db";
import { logger } from "./logger";
import { briefingHtmlToScript, synthesizeSpeech } from "./tts";
import { speFileStorage } from "./storage/spe/fileStorage";
import { signBriefingPurgeToken } from "./briefingPurgeToken";
import { sendBriefingPodcastEmail } from "./email";

const SITE_URL = (process.env["SITE_URL"] ?? "https://synozur.com").replace(
  /\/$/,
  "",
);

export type BriefingSource = "owner" | "client";

export interface ProcessBriefingArgs {
  html: string;
  subject: string;
  recipientEmail: string;
  recipientName: string | null;
  source: BriefingSource;
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
    const script = await briefingHtmlToScript(args.html);
    if (!script.trim()) {
      throw new Error("Briefing produced an empty script");
    }
    const { audio, estimatedDurationSeconds } = await synthesizeSpeech(script);

    const filename = `briefing-${new Date().toISOString().slice(0, 10)}-${podcastId.slice(0, 8)}.mp3`;
    const stored = await speFileStorage.storeFile({
      body: audio,
      filename,
      contentType: "audio/mpeg",
      documentType: "briefing",
      ownerId: podcastId,
      extraFields: { SynozurDocumentType: "briefing" },
    });

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

    const emailResult = await sendBriefingPodcastEmail({
      to: args.recipientEmail,
      recipientName: args.recipientName,
      briefingSubject: args.subject,
      audioUrl,
      purgeUrl,
      durationLabel: formatDuration(estimatedDurationSeconds),
    });
    if (emailResult.status === "error") {
      logger.warn(
        { podcastId, err: emailResult.error },
        "Briefing podcast generated but delivery email failed",
      );
    }
    logger.info(
      { podcastId, recipient: args.recipientEmail, bytes: audio.length },
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
