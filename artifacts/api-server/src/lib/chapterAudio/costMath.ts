import type { EstimateChapterAudioResponse, GetChapterAudioCostsResponse, ListChapterAudioResponse } from "@workspace/api-zod";
import type { z } from "zod";
import { buildSsml } from "../azureTts";
import { splitNarration } from "./text";

export type ChapterAudioEstimate = z.infer<typeof EstimateChapterAudioResponse>;
export type ChapterAudioMonthlyCosts = z.infer<typeof GetChapterAudioCostsResponse>;
export type ChapterAudioUsage = ChapterAudioMonthlyCosts["usage"];
export type ChapterAudioJobCost = NonNullable<z.infer<typeof ListChapterAudioResponse>["jobs"][number]["cost"]>;
export interface SpeechRate {
  id: string; perMillion: number; currency: string; effectiveFrom: string; savedAt: string;
}
export interface UsageRow {
  id: string; job_id: string | null; kind: "chapter" | "sample" | "reuse";
  actor_id: string; actor_label: string; voice: string; section_index: number | null;
  characters: number; outcome: "started" | "succeeded" | "rejected" | "uncertain";
  is_retry: boolean; rate_per_million: string | number | null; currency: string | null;
}

// Microsoft bills Unicode code points, whitespace and SSML markup other than
// speak/voice wrappers. CJK ideographs count twice. This is still an estimate:
// Azure's meter and contract are authoritative, not this application's ledger.
export function billableCharacters(text: string, voice: string): number {
  const body = buildSsml(text, voice)
    .replace(/^<speak\b[^>]*><voice\b[^>]*>/, "")
    .replace(/<\/voice><\/speak>$/, "");
  let count = 0;
  for (const ch of body) count += /\p{Unified_Ideograph}/u.test(ch) ? 2 : 1;
  return count;
}
export function makeNarration(text: string, notes?: string, appendNotes?: boolean) {
  return [text.trim(), appendNotes && notes?.trim() ? `Chapter notes.\n\n${notes.trim()}` : ""].filter(Boolean).join("\n\n");
}
export function estimateSpeech(text: string, voice: string, rate: SpeechRate | null): ChapterAudioEstimate {
  const characters = splitNarration(text).reduce((n, section) => n + billableCharacters(section, voice), 0);
  return {
    sourceCharacters: Array.from(text).length,
    billableCharacters: characters,
    estimatedCost: rate ? characters * rate.perMillion / 1_000_000 : null,
    currency: rate?.currency ?? null, rateId: rate?.id ?? null,
  };
}
export function summarizeUsage(rows: UsageRow[]): ChapterAudioUsage {
  const result: ChapterAudioUsage = {
    attempts: 0, submittedCharacters: 0, successfulCharacters: 0, uncertainCharacters: 0,
    rejectedCharacters: 0, unpricedCharacters: 0, retryCharacters: 0, sampleAttempts: 0,
    reusedSections: 0, chapterCount: 0, costs: [],
  };
  const jobs = new Set<string>();
  const costs = new Map<string, ChapterAudioUsage["costs"][number]>();
  for (const row of rows) {
    if (row.job_id) jobs.add(row.job_id);
    if (row.kind === "reuse") { result.reusedSections++; continue; }
    result.attempts++;
    result.submittedCharacters += row.characters;
    if (row.kind === "sample") result.sampleAttempts++;
    if (row.is_retry) result.retryCharacters += row.characters;
    if (row.outcome === "succeeded") result.successfulCharacters += row.characters;
    else if (row.outcome === "rejected") result.rejectedCharacters += row.characters;
    else result.uncertainCharacters += row.characters;
    // Authentication/throttling rejections are not counted as incurred costs.
    // Other unsuccessful/unfinished requests conservatively remain uncertain.
    if (row.outcome === "rejected") continue;
    if (row.rate_per_million === null || !row.currency) { result.unpricedCharacters += row.characters; continue; }
    const cost = costs.get(row.currency) ?? { currency: row.currency, amount: 0, uncertainAmount: 0, retryAmount: 0, sampleAmount: 0 };
    const amount = row.characters * Number(row.rate_per_million) / 1_000_000;
    cost.amount += amount;
    if (row.outcome !== "succeeded") cost.uncertainAmount += amount;
    if (row.is_retry) cost.retryAmount += amount;
    if (row.kind === "sample") cost.sampleAmount += amount;
    costs.set(row.currency, cost);
  }
  result.chapterCount = jobs.size;
  result.costs = [...costs.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  return result;
}
