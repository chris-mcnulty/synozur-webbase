import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import {
  db,
  cwvSamplesTable,
  collateralTable,
  mediaTable,
  publishBlocksTable,
  type InsertPublishBlock,
} from "@workspace/db";

// #142 Phase D — Build the active set of publish-state quality blocks
// from the signals shipped in Phases A–C, then reconcile against the
// `publish_blocks` table: insert new rows for fresh issues, leave
// already-active rows untouched (preserving createdAt and any admin
// override audit trail), and auto-resolve rows whose underlying signal
// has improved.
//
// The library is deliberately I/O-only — it doesn't decide *what* to
// do with the blocks. Routes and the publish mutations consume the
// resulting rows.
//
// Tunables live here as named constants rather than site-settings rows
// because they encode CWV's well-known thresholds; if/when we want
// per-environment overrides we can lift them into site_settings.

// Sliding window matching the dashboard default in /cms/site-health.
const CWV_WINDOW_DAYS = 7;

// Minimum sample count before a (route, metric) pair is allowed to
// gate publication. Below this the percentile is too noisy to act on.
const CWV_MIN_SAMPLES = 25;

// p75 thresholds for the "block" rule. These match web.dev's "poor"
// cutoffs: anything past these is meaningfully bad for procurement
// audits and SEO. The "good" cutoffs surface only as needs-improvement
// in the dashboard, not as blocks.
const CWV_P75_BLOCK_THRESHOLD: Record<string, number> = {
  LCP: 4000,
  INP: 500,
  CLS: 0.25,
  FCP: 3000,
  TTFB: 1800,
};

// Site-wide alt-text coverage gate. When fewer than half of the image
// rows have editor-written alt text, a site-level block is raised so
// the team can see the cumulative debt at a glance.
const ALT_COVERAGE_BLOCK_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

interface BlockCandidate {
  artifactKind: string;
  artifactId: string | null;
  sourceRule: string;
  severity: string;
  reason: string;
  evidence: Record<string, unknown>;
}

async function cwvCandidates(): Promise<BlockCandidate[]> {
  const since = new Date(Date.now() - CWV_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.execute<{
    route: string;
    metric: string;
    sample_count: number;
    p75: number;
  }>(sql`
    select
      ${cwvSamplesTable.route} as route,
      ${cwvSamplesTable.metric} as metric,
      count(*)::int as sample_count,
      percentile_cont(0.75) within group (order by ${cwvSamplesTable.value})::float as p75
    from ${cwvSamplesTable}
    where ${cwvSamplesTable.createdAt} >= ${since}
    group by ${cwvSamplesTable.route}, ${cwvSamplesTable.metric}
  `);

  const candidates: BlockCandidate[] = [];
  for (const r of rows.rows) {
    const sampleCount = Number(r.sample_count ?? 0);
    if (sampleCount < CWV_MIN_SAMPLES) continue;
    const threshold = CWV_P75_BLOCK_THRESHOLD[r.metric];
    if (threshold == null) continue;
    const p75 = Number(r.p75);
    if (!(p75 > threshold)) continue;
    candidates.push({
      artifactKind: "route",
      // Routes are identified by their pathname directly. A future
      // iteration that maps slugs to template IDs can swap this out.
      artifactId: r.route,
      sourceRule: `cwv.${r.metric.toLowerCase()}.p75`,
      severity: "warning",
      reason: `${r.metric} p75 ${formatMetricValue(r.metric, p75)} exceeds ${formatMetricValue(r.metric, threshold)} on ${r.route}`,
      evidence: {
        route: r.route,
        metric: r.metric,
        p75,
        threshold,
        sampleCount,
        windowDays: CWV_WINDOW_DAYS,
      },
    });
  }
  return candidates;
}

async function altTextCandidates(): Promise<BlockCandidate[]> {
  const candidates: BlockCandidate[] = [];

  // Per-row block: media rows whose alt text is still on the
  // deterministic placeholder pattern.
  const placeholderRows = await db
    .select({
      id: mediaTable.id,
      altText: mediaTable.altText,
      originalName: mediaTable.originalName,
    })
    .from(mediaTable)
    .where(
      and(ilike(mediaTable.mime, "image/%"), ilike(mediaTable.altText, "Image: %")),
    );
  for (const m of placeholderRows) {
    candidates.push({
      artifactKind: "media",
      artifactId: m.id,
      sourceRule: "alt-text.placeholder",
      severity: "warning",
      reason: `Alt text is still on the deterministic "${m.altText}" placeholder.`,
      evidence: {
        mediaId: m.id,
        currentAltText: m.altText,
        originalName: m.originalName,
      },
    });
  }

  // Site-wide block: cumulative coverage below the threshold.
  const [{ total = 0 }] = (await db
    .select({ total: sql<number>`count(*)::int` })
    .from(mediaTable)
    .where(ilike(mediaTable.mime, "image/%"))) as Array<{ total: number }>;
  const [{ placeholders = 0 }] = (await db
    .select({ placeholders: sql<number>`count(*)::int` })
    .from(mediaTable)
    .where(
      and(ilike(mediaTable.mime, "image/%"), ilike(mediaTable.altText, "Image: %")),
    )) as Array<{ placeholders: number }>;

  const reviewed = Math.max(0, Number(total) - Number(placeholders));
  const coverage = Number(total) > 0 ? reviewed / Number(total) : 1;
  if (Number(total) > 0 && coverage < ALT_COVERAGE_BLOCK_THRESHOLD) {
    candidates.push({
      artifactKind: "site",
      artifactId: null,
      sourceRule: "alt-text.coverage",
      severity: "warning",
      reason: `Editor-reviewed alt-text coverage is ${(coverage * 100).toFixed(0)}% (target ≥ ${(ALT_COVERAGE_BLOCK_THRESHOLD * 100).toFixed(0)}%).`,
      evidence: {
        totalImageMedia: Number(total),
        placeholderCount: Number(placeholders),
        reviewedCount: reviewed,
        coverageRatio: coverage,
        threshold: ALT_COVERAGE_BLOCK_THRESHOLD,
      },
    });
  }

  return candidates;
}

function formatMetricValue(metric: string, value: number): string {
  if (metric === "CLS") return value.toFixed(3);
  return `${Math.round(value)} ms`;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ScanResult {
  inserted: number;
  retained: number;
  autoResolved: number;
  total: number;
}

/**
 * Recompute candidate blocks from current signals and reconcile
 * against the `publish_blocks` table. Idempotent.
 */
export async function scanPublishBlocks(): Promise<ScanResult> {
  const candidates = [
    ...(await cwvCandidates()),
    ...(await altTextCandidates()),
  ];

  // Lookup table: existing active rows keyed by their dedup tuple.
  const existing = await db
    .select()
    .from(publishBlocksTable)
    .where(isNull(publishBlocksTable.resolvedAt));

  const dedupKey = (
    kind: string,
    id: string | null,
    rule: string,
  ) => `${kind}::${id ?? ""}::${rule}`;
  const existingByKey = new Map(
    existing.map((row) => [
      dedupKey(row.artifactKind, row.artifactId, row.sourceRule),
      row,
    ]),
  );
  const candidateKeys = new Set(
    candidates.map((c) => dedupKey(c.artifactKind, c.artifactId, c.sourceRule)),
  );

  // Insert new candidates and refresh evidence for retained ones. We
  // overwrite `evidence` and `reason` on retained rows so the admin UI
  // always shows the current metric value, but we leave `createdAt`
  // untouched to preserve the "first seen" time.
  let inserted = 0;
  let retained = 0;
  const inserts: InsertPublishBlock[] = [];
  for (const c of candidates) {
    const key = dedupKey(c.artifactKind, c.artifactId, c.sourceRule);
    const hit = existingByKey.get(key);
    if (hit) {
      await db
        .update(publishBlocksTable)
        .set({
          severity: c.severity,
          reason: c.reason,
          evidence: c.evidence,
        })
        .where(eq(publishBlocksTable.id, hit.id));
      retained += 1;
    } else {
      inserts.push({
        artifactKind: c.artifactKind,
        artifactId: c.artifactId,
        sourceRule: c.sourceRule,
        severity: c.severity,
        reason: c.reason,
        evidence: c.evidence,
      });
    }
  }
  if (inserts.length > 0) {
    await db.insert(publishBlocksTable).values(inserts);
    inserted = inserts.length;
  }

  // Auto-resolve: any active row that is no longer represented in the
  // candidate set has been "fixed" — clear its underlying signal. We
  // do this without `resolvedBy` / `resolutionNote` so the admin UI
  // can distinguish auto-resolves from manual overrides.
  let autoResolved = 0;
  const stale = existing.filter(
    (row) =>
      !candidateKeys.has(dedupKey(row.artifactKind, row.artifactId, row.sourceRule)),
  );
  if (stale.length > 0) {
    const now = new Date();
    for (const row of stale) {
      await db
        .update(publishBlocksTable)
        .set({ resolvedAt: now })
        .where(eq(publishBlocksTable.id, row.id));
    }
    autoResolved = stale.length;
  }

  return {
    inserted,
    retained,
    autoResolved,
    total: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers consumed by routes and admin pages
// ---------------------------------------------------------------------------

export async function listActivePublishBlocks(filter?: {
  artifactKind?: string;
  artifactId?: string | null;
}) {
  const filters = [isNull(publishBlocksTable.resolvedAt)];
  if (filter?.artifactKind) {
    filters.push(eq(publishBlocksTable.artifactKind, filter.artifactKind));
  }
  if (filter?.artifactId !== undefined) {
    filters.push(
      filter.artifactId === null
        ? isNull(publishBlocksTable.artifactId)
        : eq(publishBlocksTable.artifactId, filter.artifactId),
    );
  }
  return db
    .select()
    .from(publishBlocksTable)
    .where(and(...filters));
}

/**
 * Per-artifact lookup used by the publish mutations. In warn-mode the
 * caller logs / surfaces the result; in the hard-mode follow-up the
 * caller will reject the mutation when the array is non-empty.
 *
 * For collateral specifically, this also pulls route-level CWV blocks
 * keyed on the canonical URL — so an LCP regression on `/library/foo`
 * surfaces in the editor for the collateral row that owns that slug.
 */
export async function activeBlocksForCollateral(collateralId: string) {
  const direct = await listActivePublishBlocks({
    artifactKind: "collateral",
    artifactId: collateralId,
  });
  const item = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.id, collateralId),
  });
  let routeBlocks: typeof direct = [];
  if (item) {
    routeBlocks = await listActivePublishBlocks({
      artifactKind: "route",
      artifactId: item.url,
    });
  }
  return [...direct, ...routeBlocks];
}
