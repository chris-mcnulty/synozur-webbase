import { SpeGraphRequestError } from "../storage/spe/graphClient";

export type ChapterStage = "source_read" | "section_read" | "speech" | "section_save" | "section_progress" | "assembly" | "final_save" | "complete";
export interface ChapterFailure {
  at: string; stage: ChapterStage; code: string; attempt: number;
  elapsedMs: number; willRetry: boolean;
}
export class ChapterProcessingError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) { super(code); }
}
export class ChapterLeaseLost extends Error {}

/** Never return error messages, stderr, request URLs, paths or provider bodies. */
export function classifyChapterFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof ChapterProcessingError) return { code: error.code, retryable: error.retryable };
  if (error instanceof SpeGraphRequestError) {
    return {
      code: `storage_http_${error.status}`,
      retryable: error.status === 408 || error.status === 429 || error.status >= 500,
    };
  }
  const record = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } : {};
  if (record.name === "TimeoutError" || record.name === "AbortError") return { code: "request_timeout", retryable: true };
  const code = record.code ?? record.cause?.code;
  if (typeof code === "string" && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)) {
    return { code: "network_interrupted", retryable: true };
  }
  if (typeof code === "string" && ["40001", "40P01", "53300", "57P01", "08000", "08003", "08006"].includes(code)) {
    return { code: "database_temporarily_unavailable", retryable: true };
  }
  return { code: "unexpected_failure", retryable: false };
}

export const CHAPTER_STAGE_LABELS: Record<ChapterStage, string> = {
  source_read: "Reading the manuscript", section_read: "Reading saved narration",
  speech: "Generating narration", section_save: "Saving a narrated section",
  section_progress: "Updating narration progress", assembly: "Assembling the MP3",
  final_save: "Saving the finished MP3 to SharePoint", complete: "Recording completion",
};
