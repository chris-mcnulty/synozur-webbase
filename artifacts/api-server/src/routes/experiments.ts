import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  experimentsTable,
  experimentVariantsTable,
  experimentAssignmentsTable,
} from "@workspace/db";
import {
  GetActiveExperimentsResponse,
  PostExperimentAssignmentBody,
  PostExperimentAssignmentResponse,
  OverrideMap,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ----- Public: GET /api/experiments/active -------------------------------
//
// In-memory cache so the homepage hot-path query is one DB read across all
// concurrent visitors. Keyed on a checksum derived from MAX(updated_at)
// across experiments + variants — any admin write bumps the value and the
// cache misses on the next request. TTL is a fast-fail safety net.

const ACTIVE_CACHE_TTL_MS = 30_000;
let cachedResponse: {
  builtAt: number;
  rev: string;
  payload: unknown;
} | null = null;

async function computeRev(): Promise<string> {
  // Cast to text rather than format with millisecond precision so writes
  // landing in the same millisecond still produce distinct revs and the
  // cache invalidates correctly.
  const result = await db.execute<{ rev: string | null }>(sql`
    SELECT
      GREATEST(
        COALESCE((SELECT MAX(updated_at) FROM experiments), 'epoch'::timestamptz),
        COALESCE((SELECT MAX(updated_at) FROM experiment_variants), 'epoch'::timestamptz)
      )::text AS rev
  `);
  return (result.rows[0]?.rev as string) ?? "0";
}

async function buildActivePayload() {
  const running = await db
    .select()
    .from(experimentsTable)
    .where(eq(experimentsTable.status, "running"));
  if (running.length === 0) {
    return GetActiveExperimentsResponse.parse({
      experiments: [],
      generatedAt: new Date().toISOString(),
    });
  }
  // Restrict the variants query to experiments currently running so the
  // cost grows with the live cohort, not the full history of ended/draft
  // experiments accumulated in the table.
  const variants = await db
    .select()
    .from(experimentVariantsTable)
    .where(
      inArray(
        experimentVariantsTable.experimentId,
        running.map((e) => e.id),
      ),
    )
    .orderBy(asc(experimentVariantsTable.key));

  const variantsByExperiment = new Map<string, typeof variants>();
  for (const v of variants) {
    const list = variantsByExperiment.get(v.experimentId) ?? [];
    list.push(v);
    variantsByExperiment.set(v.experimentId, list);
  }

  const experiments = running.flatMap((exp) => {
    const list = variantsByExperiment.get(exp.id) ?? [];
    if (list.length === 0) return [];
    return [
      {
        key: exp.key,
        pageKey: exp.pageKey,
        trafficPercentage: exp.trafficPercentage,
        holdbackPercentage: exp.holdbackPercentage ?? 0,
        conversionPaths: exp.conversionPaths ?? [],
        variants: list.map((v) => {
          // Defensive: a malformed `overrides` JSONB row (e.g. legacy
          // shape, hand-edit, future schema we don't know yet) must
          // not turn /experiments/active into a 500 for everyone.
          // safeParse + empty-fallback degrades gracefully.
          const parsed = OverrideMap.safeParse(v.overrides ?? {});
          return {
            key: v.key,
            name: v.name,
            isControl: v.isControl,
            weight: v.weight,
            overrides: parsed.success ? parsed.data : {},
          };
        }),
      },
    ];
  });

  return GetActiveExperimentsResponse.parse({
    experiments,
    generatedAt: new Date().toISOString(),
  });
}

export function invalidateActiveExperimentsCache(): void {
  cachedResponse = null;
}

router.get("/experiments/active", async (_req, res): Promise<void> => {
  const now = Date.now();
  // Hot-path cache: cache hits skip the DB entirely. Admin writes call
  // invalidateActiveExperimentsCache() so the next request rebuilds;
  // the TTL is a safety net for cross-instance writes that don't run
  // through this process. computeRev was previously consulted on every
  // hit, which negated the cache — now it's only checked when the TTL
  // expires (and only as a no-op-detector to avoid re-parsing if
  // nothing changed).
  const isFresh =
    cachedResponse !== null &&
    now - cachedResponse.builtAt <= ACTIVE_CACHE_TTL_MS;
  if (!isFresh) {
    const rev = await computeRev();
    if (cachedResponse && cachedResponse.rev === rev) {
      // Nothing changed in the DB — bump builtAt to extend the TTL
      // window and skip the rebuild work.
      cachedResponse = { ...cachedResponse, builtAt: now };
    } else {
      const payload = await buildActivePayload();
      cachedResponse = { builtAt: now, rev, payload };
    }
  }
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
  res.json(cachedResponse!.payload);
});

// ----- Public: POST /api/experiments/assignments -------------------------
//
// Idempotent upsert keyed on (experimentId, visitorId). Fire-and-forget
// from the client; failures don't break rendering. We look up the
// experiment by key (not id) so the client doesn't have to expose UUIDs.

router.post("/experiments/assignments", async (req, res): Promise<void> => {
  const parsed = PostExperimentAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { experimentKey, variantKey, visitorId, forcedBy } = parsed.data;

  const [exp] = await db
    .select({ id: experimentsTable.id, status: experimentsTable.status })
    .from(experimentsTable)
    .where(eq(experimentsTable.key, experimentKey));
  if (!exp) {
    // Unknown key. Don't tell the client whether the experiment ever
    // existed — clients shouldn't be retrying anyway.
    res.json(PostExperimentAssignmentResponse.parse({ ok: true }));
    return;
  }
  // Only accept assignments for experiments currently running. Stale
  // clients writing into ended experiments would skew reporting.
  if (exp.status !== "running") {
    res.json(PostExperimentAssignmentResponse.parse({ ok: true }));
    return;
  }

  // "_holdback" is a synthetic bucket — visitors held back from any
  // treatment so we can compare a baseline cohort over time. It's
  // never persisted in experiment_variants but IS a valid assignment
  // value, so accept it without the lookup.
  if (variantKey !== "_holdback") {
    const [variant] = await db
      .select({ key: experimentVariantsTable.key })
      .from(experimentVariantsTable)
      .where(
        and(
          eq(experimentVariantsTable.experimentId, exp.id),
          eq(experimentVariantsTable.key, variantKey),
        ),
      );
    if (!variant) {
      res.json(PostExperimentAssignmentResponse.parse({ ok: true }));
      return;
    }
  }

  await db
    .insert(experimentAssignmentsTable)
    .values({
      experimentId: exp.id,
      visitorId,
      variantKey,
      forcedBy: forcedBy ?? null,
    })
    .onConflictDoNothing({
      target: [
        experimentAssignmentsTable.experimentId,
        experimentAssignmentsTable.visitorId,
      ],
    });

  res.json(PostExperimentAssignmentResponse.parse({ ok: true }));
});

export default router;
