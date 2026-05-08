import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  experimentsTable,
  experimentVariantsTable,
  experimentAssignmentsTable,
} from "@workspace/db";
import {
  GetActiveExperimentsResponse,
  PostAssignmentBody,
  PostAssignmentResponse,
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
  const result = await db.execute<{ rev: string | null }>(sql`
    SELECT
      to_char(
        GREATEST(
          COALESCE((SELECT MAX(updated_at) FROM experiments), 'epoch'::timestamptz),
          COALESCE((SELECT MAX(updated_at) FROM experiment_variants), 'epoch'::timestamptz)
        ),
        'YYYY-MM-DD"T"HH24:MI:SS.MS'
      ) AS rev
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
  const variants = await db
    .select()
    .from(experimentVariantsTable)
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
        conversionPaths: exp.conversionPaths ?? [],
        variants: list.map((v) => ({
          key: v.key,
          name: v.name,
          isControl: v.isControl,
          weight: v.weight,
          // Strip any unknown keys that fail strict validation. The schema
          // is permissive (catchall) but defensive parsing protects clients
          // from bad data slipping in via direct DB writes.
          overrides: OverrideMap.parse(v.overrides ?? {}),
        })),
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
  let needsRebuild = !cachedResponse;
  if (cachedResponse && now - cachedResponse.builtAt > ACTIVE_CACHE_TTL_MS) {
    needsRebuild = true;
  }
  if (!needsRebuild && cachedResponse) {
    const rev = await computeRev();
    if (rev !== cachedResponse.rev) needsRebuild = true;
  }
  if (needsRebuild) {
    const [payload, rev] = await Promise.all([
      buildActivePayload(),
      computeRev(),
    ]);
    cachedResponse = { builtAt: now, rev, payload };
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
  const parsed = PostAssignmentBody.safeParse(req.body);
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
    res.json(PostAssignmentResponse.parse({ ok: true }));
    return;
  }
  // Only accept assignments for experiments currently running. Stale
  // clients writing into ended experiments would skew reporting.
  if (exp.status !== "running") {
    res.json(PostAssignmentResponse.parse({ ok: true }));
    return;
  }

  // Confirm the variant key is real for this experiment.
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
    res.json(PostAssignmentResponse.parse({ ok: true }));
    return;
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

  res.json(PostAssignmentResponse.parse({ ok: true }));
});

export default router;
