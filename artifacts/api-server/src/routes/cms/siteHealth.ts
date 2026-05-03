import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import {
  db,
  cwvSamplesTable,
  mediaTable,
  wixRedirectsTable,
  aiChatTokenUsageTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";

const router: IRouter = Router();

const Query = z.object({
  windowDays: z.coerce.number().int().min(1).max(90).default(7),
});

router.get(
  "/cms/site-health",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const { windowDays } = parsed.data;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // ---------------------------------------------------------------------
    // CWV percentiles. PostgreSQL's `percentile_cont` is a continuous
    // estimator over a sorted set; we group by (route, metric) and return
    // the top 50 (route, metric) pairs by sample count. The dashboard
    // sorts/filters client-side from there.
    // ---------------------------------------------------------------------
    const cwvRows = await db.execute<{
      route: string;
      metric: string;
      sample_count: number;
      p50: number;
      p75: number;
      p90: number;
    }>(sql`
      select
        ${cwvSamplesTable.route} as route,
        ${cwvSamplesTable.metric} as metric,
        count(*)::int as sample_count,
        percentile_cont(0.50) within group (order by ${cwvSamplesTable.value})::float as p50,
        percentile_cont(0.75) within group (order by ${cwvSamplesTable.value})::float as p75,
        percentile_cont(0.90) within group (order by ${cwvSamplesTable.value})::float as p90
      from ${cwvSamplesTable}
      where ${cwvSamplesTable.createdAt} >= ${since}
      group by ${cwvSamplesTable.route}, ${cwvSamplesTable.metric}
      order by sample_count desc
      limit 50
    `);

    const cwv = cwvRows.rows.map((r) => ({
      route: r.route,
      metric: r.metric,
      sampleCount: Number(r.sample_count ?? 0),
      p50: Number(r.p50 ?? 0),
      p75: Number(r.p75 ?? 0),
      p90: Number(r.p90 ?? 0),
    }));

    // ---------------------------------------------------------------------
    // Alt-text coverage. Image-MIME media rows whose alt_text starts with
    // "Image: " are counted as placeholders (the deterministic shape used
    // by both the upload UI and the backfill script). Anything else is
    // treated as editor-reviewed content.
    // ---------------------------------------------------------------------
    const [{ total: totalImageMedia = 0 }] = (await db
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(mediaTable)
      .where(ilike(mediaTable.mime, "image/%"))) as Array<{ total: number }>;

    const [{ placeholder: placeholderCount = 0 }] = (await db
      .select({
        placeholder: sql<number>`count(*)::int`,
      })
      .from(mediaTable)
      .where(
        and(ilike(mediaTable.mime, "image/%"), ilike(mediaTable.altText, "Image: %")),
      )) as Array<{ placeholder: number }>;

    const reviewedCount = Math.max(0, totalImageMedia - placeholderCount);
    const coverageRatio = totalImageMedia > 0 ? reviewedCount / totalImageMedia : 0;

    // ---------------------------------------------------------------------
    // Redirect health. We surface (a) totals, (b) the top 10 most-hit
    // active redirects, and (c) any active redirect whose target is the
    // source path of another active redirect — a one-hop chain that
    // burns a network round-trip and should usually be flattened.
    // ---------------------------------------------------------------------
    const [{ total: totalActive = 0 }] = (await db
      .select({ total: sql<number>`count(*)::int` })
      .from(wixRedirectsTable)
      .where(eq(wixRedirectsTable.active, true))) as Array<{ total: number }>;

    const [{ hits: totalHits = 0 }] = (await db
      .select({ hits: sql<number>`coalesce(sum(${wixRedirectsTable.hitCount}), 0)::int` })
      .from(wixRedirectsTable)
      .where(eq(wixRedirectsTable.active, true))) as Array<{ hits: number }>;

    const topRedirects = await db
      .select()
      .from(wixRedirectsTable)
      .where(eq(wixRedirectsTable.active, true))
      .orderBy(desc(wixRedirectsTable.hitCount))
      .limit(10);

    // One-hop chain detection: a redirect r1 chains when there exists
    // another active redirect r2 with r2.source_path = r1.target_path.
    const chainRows = await db.execute<{
      id: string;
      source_path: string;
      target_path: string;
      status_code: number;
      active: boolean;
      hit_count: number;
      last_hit_at: Date | null;
    }>(sql`
      select r1.id, r1.source_path, r1.target_path, r1.status_code,
             r1.active, r1.hit_count, r1.last_hit_at
      from ${wixRedirectsTable} r1
      where r1.active = true
        and exists (
          select 1 from ${wixRedirectsTable} r2
          where r2.active = true
            and r2.source_path = r1.target_path
        )
      order by r1.hit_count desc
      limit 25
    `);

    const serializeRedirect = (r: {
      id: string;
      sourcePath: string;
      targetPath: string;
      statusCode: number;
      active: boolean;
      hitCount: number;
      lastHitAt: Date | null;
    }) => ({
      id: r.id,
      sourcePath: r.sourcePath,
      targetPath: r.targetPath,
      statusCode: r.statusCode,
      active: r.active,
      hitCount: r.hitCount,
      lastHitAt: r.lastHitAt ? r.lastHitAt.toISOString() : null,
    });

    const serializeRedirectRow = (r: {
      id: string;
      source_path: string;
      target_path: string;
      status_code: number;
      active: boolean;
      hit_count: number;
      last_hit_at: Date | null;
    }) => ({
      id: r.id,
      sourcePath: r.source_path,
      targetPath: r.target_path,
      statusCode: Number(r.status_code),
      active: r.active,
      hitCount: Number(r.hit_count ?? 0),
      lastHitAt: r.last_hit_at ? new Date(r.last_hit_at).toISOString() : null,
    });

    // ---------------------------------------------------------------------
    // AI prompt-cache hit rate (#167). Daily rollup of /ai/chat token
    // usage, used to chart cache-hit rate and dollar savings, and to
    // page the on-call when the most recent full UTC day's hit rate
    // drops below 50 %.
    //
    // Cost model (Anthropic public rates as of 2026-05): cached reads
    // bill at ~10 % of the standard input rate, cache writes at ~125 %.
    // We compute a model-agnostic "what would this have cost without
    // caching" estimate by treating every cache-read token as if it
    // had been a fresh input token; the savings = (full_cost - actual)
    // and we ratio that against full_cost. Dashboard renders dollar
    // figures with a per-model rate map on the client.
    // ---------------------------------------------------------------------
    const aiCacheRows = await db
      .select()
      .from(aiChatTokenUsageTable)
      .where(sql`${aiChatTokenUsageTable.utcDay} >= (current_date - ${windowDays}::int)`)
      .orderBy(desc(aiChatTokenUsageTable.utcDay));

    // Per-million-token USD rates. Anthropic's 5-minute ephemeral
    // pricing model is uniform across the supported families: cache
    // writes are billed at 1.25x of the standard input rate and cache
    // reads at 0.1x. We keep a small per-model rate table here so the
    // savings figures on Site Health are model-aware; falling back to
    // the Sonnet rate for unknown ids keeps the dashboard sane through
    // an SDK upgrade that introduces a new model name.
    const RATES_PER_MTOK: Record<
      string,
      { input: number; output: number }
    > = {
      "claude-sonnet-4-6": { input: 3, output: 15 },
      "claude-sonnet-4-5": { input: 3, output: 15 },
      "claude-haiku-4-5": { input: 1, output: 5 },
      "claude-opus-4-5": { input: 15, output: 75 },
    };
    const FALLBACK_RATE = { input: 3, output: 15 };
    const CACHE_WRITE_MULT = 1.25;
    const CACHE_READ_MULT = 0.1;

    const aiCacheDaily = aiCacheRows.map((r) => {
      const inputBillable = r.inputTokens + r.cacheCreationInputTokens;
      const cachedRead = r.cacheReadInputTokens;
      const totalInputEquivalent = inputBillable + cachedRead;
      const hitRate =
        totalInputEquivalent > 0 ? cachedRead / totalInputEquivalent : 0;
      const requestHitRate =
        r.requestCount > 0 ? r.warmRequestCount / r.requestCount : 0;

      // Pick the rate by exact id, then by family-prefix so an upgrade
      // to claude-sonnet-4-7 still gets Sonnet pricing instead of the
      // fallback. Family prefix is derived from the first two dash-
      // separated chunks (e.g. "claude-sonnet").
      const family = r.model.split("-").slice(0, 2).join("-");
      const rate =
        RATES_PER_MTOK[r.model] ??
        Object.entries(RATES_PER_MTOK).find(([k]) =>
          k.startsWith(family + "-"),
        )?.[1] ??
        FALLBACK_RATE;

      const inputRatePerToken = rate.input / 1_000_000;
      const outputRatePerToken = rate.output / 1_000_000;

      // Counter-factual cost if caching were disabled — every input,
      // cache_creation, and cache_read token would have been billed at
      // the standard input rate. Output tokens are unaffected.
      const fullCost =
        (r.inputTokens + r.cacheCreationInputTokens + r.cacheReadInputTokens) *
          inputRatePerToken +
        r.outputTokens * outputRatePerToken;

      // Actual cost as billed: cache_creation at 1.25x, cache_read at
      // 0.1x. Cold-cache days where cache_creation dominates can
      // produce a slightly NEGATIVE savings number — that's fine and
      // the dashboard makes it visible so editors can see the warm-up
      // period before the savings curve hits its asymptote.
      const actualCost =
        r.inputTokens * inputRatePerToken +
        r.cacheCreationInputTokens * inputRatePerToken * CACHE_WRITE_MULT +
        r.cacheReadInputTokens * inputRatePerToken * CACHE_READ_MULT +
        r.outputTokens * outputRatePerToken;

      // drizzle's `date` column returns a string in YYYY-MM-DD form on
      // node-postgres, but the runtime has historically yielded Date on
      // some adapter versions — accept either.
      const utcDay =
        typeof r.utcDay === "string"
          ? r.utcDay
          : (r.utcDay as Date).toISOString().slice(0, 10);
      return {
        utcDay,
        model: r.model,
        requestCount: r.requestCount,
        warmRequestCount: r.warmRequestCount,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheCreationInputTokens: r.cacheCreationInputTokens,
        cacheReadInputTokens: r.cacheReadInputTokens,
        hitRate,
        requestHitRate,
        estimatedFullCostUsd: fullCost,
        estimatedActualCostUsd: actualCost,
        estimatedSavingsUsd: fullCost - actualCost,
      };
    });

    const totalSavingsUsd = aiCacheDaily.reduce(
      (s, d) => s + d.estimatedSavingsUsd,
      0,
    );

    // Most-recent fully-elapsed UTC day across all models. The current
    // UTC day is excluded because partial-day samples cause noisy
    // alerts during low-traffic mornings.
    const todayUtc = new Date().toISOString().slice(0, 10);
    const yesterdayRows = aiCacheDaily.filter((d) => d.utcDay < todayUtc);
    const latestComplete = yesterdayRows[0]?.utcDay ?? null;
    const latestRows = latestComplete
      ? yesterdayRows.filter((d) => d.utcDay === latestComplete)
      : [];
    const latestAgg = latestRows.reduce(
      (acc, r) => {
        acc.requestCount += r.requestCount;
        acc.warmRequestCount += r.warmRequestCount;
        acc.inputTokens += r.inputTokens;
        acc.outputTokens += r.outputTokens;
        acc.cacheCreationInputTokens += r.cacheCreationInputTokens;
        acc.cacheReadInputTokens += r.cacheReadInputTokens;
        return acc;
      },
      {
        requestCount: 0,
        warmRequestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    );
    const latestInputEq =
      latestAgg.inputTokens +
      latestAgg.cacheCreationInputTokens +
      latestAgg.cacheReadInputTokens;
    const latestHitRate =
      latestInputEq > 0 ? latestAgg.cacheReadInputTokens / latestInputEq : 0;

    // Pager rule: the most recent fully-elapsed UTC day must have at
    // least 50 % cache-hit rate. We require a minimum of 5 requests so
    // a single-request day with a cold cache doesn't trip the alert.
    const ALERT_THRESHOLD = 0.5;
    const ALERT_MIN_REQUESTS = 5;
    const alert =
      latestComplete && latestAgg.requestCount >= ALERT_MIN_REQUESTS
        ? latestHitRate < ALERT_THRESHOLD
          ? {
              severity: "page" as const,
              message: `AI prompt-cache hit rate dropped to ${(latestHitRate * 100).toFixed(1)}% on ${latestComplete} (threshold ${ALERT_THRESHOLD * 100}%).`,
            }
          : { severity: "ok" as const, message: null }
        : { severity: "insufficient-data" as const, message: null };

    res.json({
      generatedAt: new Date().toISOString(),
      windowDays,
      cwv,
      altText: {
        totalImageMedia: Number(totalImageMedia),
        placeholderCount: Number(placeholderCount),
        reviewedCount,
        coverageRatio,
      },
      redirects: {
        totalActive: Number(totalActive),
        totalHits: Number(totalHits),
        top: topRedirects.map(serializeRedirect),
        chains: chainRows.rows.map(serializeRedirectRow),
      },
      aiPromptCache: {
        daily: aiCacheDaily,
        latestComplete,
        latestHitRate,
        latestRequestCount: latestAgg.requestCount,
        estimatedSavingsUsd: totalSavingsUsd,
        alert,
        thresholds: {
          hitRate: ALERT_THRESHOLD,
          minRequests: ALERT_MIN_REQUESTS,
        },
      },
    });
  },
);

export default router;
