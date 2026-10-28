import type { ChapterAudioJob } from "@workspace/api-client-react";

export function chapterStatusText(job: Pick<ChapterAudioJob, "status" | "completedChunks" | "totalChunks">): string {
  switch (job.status) {
    case "queued": return "In queue — waiting to start.";
    case "processing": return `Processing — ${job.completedChunks} of ${job.totalChunks} segments rendered.`;
    case "completed": return "Ready — your MP3 can be played or downloaded below.";
    case "failed": return "Failed — see the error and Retry option below.";
    case "cancelled": return "Cancelled — you can retry below.";
    case "expired": return "Expired — audio is no longer available.";
    case "deleting": return "Deleting — files are being removed.";
    default: return "Checking status…";
  }
}
