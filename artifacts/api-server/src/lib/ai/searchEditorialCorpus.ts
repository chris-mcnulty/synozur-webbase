import { sql } from "drizzle-orm";
import { db, type EditorialSourceKind } from "@workspace/db";

// Hybrid retrieval over editorial_chunks. Phase-0 is FTS-only (per #170);
// vector similarity will join in once an embeddings provider is wired up.
//
// We score each row with `ts_rank_cd` over the `text_search` generated
// tsvector and return the top-k results with source metadata sufficient
// for citation. The "BM25 over collateral.title/excerpt" leg called for
// in the task description is approximated here by the title-weighted
// tsvector — the title is stored on every chunk row.

export interface CorpusHit {
  id: string;
  kind: EditorialSourceKind;
  sourceId: string;
  title: string;
  url: string;
  text: string;
  score: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  kinds?: readonly EditorialSourceKind[];
}

export async function searchEditorialCorpus(
  opts: SearchOptions,
): Promise<CorpusHit[]> {
  const trimmed = opts.query.trim();
  if (!trimmed) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 6, 25));

  // Use plainto_tsquery so user input is treated as natural language;
  // websearch_to_tsquery would also work but requires Postgres ≥ 11 with
  // English-aware parser — plainto is the safer cross-version choice.
  const kinds = opts.kinds && opts.kinds.length > 0 ? opts.kinds : null;

  const rows = await db.execute<{
    id: string;
    source_kind: string;
    source_id: string;
    title: string;
    url: string;
    text: string;
    score: number;
  }>(sql`
    SELECT
      id,
      source_kind,
      source_id,
      title,
      url,
      text,
      ts_rank_cd(text_search, plainto_tsquery('english', ${trimmed}))::float8 AS score
    FROM editorial_chunks
    WHERE text_search @@ plainto_tsquery('english', ${trimmed})
      ${kinds ? sql`AND source_kind = ANY(${kinds as unknown as string[]})` : sql``}
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  // drizzle-orm returns the raw pg result on db.execute; guard both shapes.
  const list = (
    Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []
  ) as Array<{
    id: string;
    source_kind: string;
    source_id: string;
    title: string;
    url: string;
    text: string;
    score: number;
  }>;

  return list.map((r) => ({
    id: r.id,
    kind: r.source_kind as EditorialSourceKind,
    sourceId: r.source_id,
    title: r.title,
    url: r.url,
    text: r.text,
    score: Number(r.score),
  }));
}

// Threshold below which we treat a match as "low confidence" — surfaced in
// the questions log so editors can see where the corpus is thin.
export const LOW_CONFIDENCE_SCORE = 0.05;
