import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import {
  db,
  cwvSamplesTable,
  mediaTable,
  wixRedirectsTable,
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
    });
  },
);

export default router;
