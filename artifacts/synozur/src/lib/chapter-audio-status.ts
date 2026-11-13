import type { ChapterAudioJob } from "@workspace/api-client-react";

const STAGE_LABELS: Record<string, string> = {
  source_read: "Reading the manuscript", section_read: "Reading saved narration",
  speech: "Generating narration", section_save: "Saving a narrated section",
  section_progress: "Updating narration progress", assembly: "Assembling the MP3",
  final_save: "Saving the finished MP3 to SharePoint", complete: "Recording completion",
};
export function chapterStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? "Processing";
}

export function chapterStatusText(job: Pick<ChapterAudioJob, "status" | "completedChunks" | "totalChunks" | "processingStage">): string {
  switch (job.status) {
    case "queued": return "In queue — waiting to start.";
    case "processing": {
      if (job.processingStage && ["assembly", "final_save", "complete"].includes(job.processingStage)) {
        return `${chapterStageLabel(job.processingStage)} — narration is complete; the download is not ready yet.`;
      }
      return `Processing — ${job.completedChunks} of ${job.totalChunks} segments rendered.`;
    }
    case "completed": return "Ready — your MP3 can be played or downloaded below.";
    case "failed": return "Failed — see the error and Retry option below.";
    case "cancelled": return "Cancelled — you can retry below.";
    case "expired": return "Expired — audio is no longer available.";
    case "deleting": return "Deleting — files are being removed.";
    default: return "Checking status…";
  }
}
