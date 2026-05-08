import { and, eq, sql } from "drizzle-orm";
import {
  db,
  experimentsTable,
  experimentVariantsTable,
  experimentAssignmentsTable,
  trafficEventsTable,
  type Experiment,
  type ExperimentVariant,
} from "@workspace/db";

// Abramowitz & Stegun 26.2.17 normal CDF approximation. Same as the
// admin results aggregator — duplicated here to keep this module
// dependency-free of the routes layer.
function normalCdf(x: number): number {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;
  if (x >= 0) {
    const t = 1 / (1 + p * x);
    return (
      1 -
      c *
        Math.exp((-x * x) / 2) *
        t *
        (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))))
    );
  }
  return 1 - normalCdf(-x);
}

/**
 * Decide whether a running experiment satisfies its configured
 * auto-stop policy. Returns the reason (for audit) or null. Cheap
 * enough to call hourly: 1 SQL aggregate per experiment.
 */
export async function evaluateAutoStop(
  exp: Experiment,
  variants: ExperimentVariant[],
): Promise<{ reason: string } | null> {
  if (exp.status !== "running") return null;

  // Time-based check first — cheapest path.
  if (exp.autoStopAfterDays && exp.startedAt) {
    const ageMs = Date.now() - new Date(exp.startedAt).getTime();
    const limitMs = exp.autoStopAfterDays * 24 * 60 * 60 * 1000;
    if (ageMs >= limitMs) {
      return {
        reason: `Reached configured ${exp.autoStopAfterDays}-day duration.`,
      };
    }
  }

  if (!exp.autoStopOnSignificance) return null;

  // Significance check. Same query shape as the admin results route
  // but joined-and-grouped in a single round-trip. We aggregate
  // distinct in-test visitors per variant and the union of all
  // conversion targets.
  const conversions = exp.conversionPaths ?? [];
  if (conversions.length === 0) return null;

  const conversionMatch = sql.join(
    conversions.map((cp) => {
      if (cp.kind === "path") {
        return sql`(${trafficEventsTable.eventName} = 'conversion.path.visit'
          AND ${trafficEventsTable.properties}->>'path' = ${cp.value})`;
      }
      if (cp.kind === "booking") {
        return sql`(${trafficEventsTable.eventName} = 'conversion.booking.click'
          AND ${trafficEventsTable.properties}->>'eventId' = ${cp.value})`;
      }
      return sql`(${trafficEventsTable.eventName} = ${cp.value})`;
    }),
    sql` OR `,
  );

  const result = await db.execute<{
    variant_key: string;
    visitors: number;
    conversions: number;
  }>(sql`
    SELECT a.variant_key,
           COUNT(DISTINCT a.visitor_id)::int AS visitors,
           COUNT(DISTINCT
             CASE WHEN e.id IS NOT NULL THEN a.visitor_id END
           )::int AS conversions
    FROM ${experimentAssignmentsTable} a
    LEFT JOIN ${trafficEventsTable} e
      ON e.properties->>'visitor_id' = a.visitor_id
      AND e.occurred_at >= a.assigned_at
      AND (${conversionMatch})
    WHERE a.experiment_id = ${exp.id}
      AND a.forced_by IS NULL
    GROUP BY a.variant_key
  `);

  const stats = new Map<string, { visitors: number; conversions: number }>();
  for (const r of result.rows) {
    stats.set(r.variant_key, {
      visitors: Number(r.visitors),
      conversions: Number(r.conversions),
    });
  }

  const controlKey = variants.find((v) => v.isControl)?.key;
  if (!controlKey) return null;
  const control = stats.get(controlKey);
  if (!control) return null;

  const minVisitors = exp.minVisitorsForAutoStop ?? 1000;

  // Require every reportable bucket to meet the minimum sample size
  // before we accept any significance — that includes the synthetic
  // _holdback bucket when the experiment configures one. Otherwise a
  // tiny holdback cohort could trip the policy via random variance.
  for (const v of variants) {
    const s = stats.get(v.key);
    if (!s || s.visitors < minVisitors) return null;
  }
  if ((exp.holdbackPercentage ?? 0) > 0) {
    const holdback = stats.get("_holdback");
    if (!holdback || holdback.visitors < minVisitors) return null;
  }

  // Test each non-control variant against control. Two-proportion
  // z-test, two-tailed p < 0.05 = z > 1.96 in absolute value.
  for (const v of variants) {
    if (v.key === controlKey) continue;
    const s = stats.get(v.key);
    if (!s) continue;
    const p1 = s.conversions / s.visitors;
    const p2 = control.conversions / control.visitors;
    const pPool =
      (s.conversions + control.conversions) /
      (s.visitors + control.visitors);
    const denom = Math.sqrt(
      pPool * (1 - pPool) * (1 / s.visitors + 1 / control.visitors),
    );
    if (denom === 0) continue;
    const z = (p1 - p2) / denom;
    const pValue = 2 * (1 - normalCdf(Math.abs(z)));
    if (pValue < 0.05) {
      return {
        reason: `Variant "${v.key}" reached p<0.05 vs control (z=${z.toFixed(2)}, p=${pValue.toFixed(3)}).`,
      };
    }
  }

  return null;
}

/**
 * Sweep all running experiments and apply auto-stop policies. Called
 * by the scheduler. Each transition writes an audit log row and
 * invalidates the public-cache so the next /experiments/active read
 * doesn't keep serving the now-ended experiment.
 */
export async function runAutoStopSweep(opts: {
  invalidateCache: () => void;
  audit: (params: {
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string;
    diff: unknown;
  }) => Promise<void>;
}): Promise<{ stopped: number }> {
  const running = await db
    .select()
    .from(experimentsTable)
    .where(eq(experimentsTable.status, "running"));
  let stopped = 0;
  for (const exp of running) {
    const variants = await db
      .select()
      .from(experimentVariantsTable)
      .where(eq(experimentVariantsTable.experimentId, exp.id));
    const decision = await evaluateAutoStop(exp, variants);
    if (!decision) continue;
    // Use .returning() so we can verify the UPDATE actually
    // transitioned a row before auditing/counting. A race against a
    // manual end (or another scheduler instance) would leave the row
    // already non-running and the WHERE-clause guard would no-op —
    // we mustn't emit a phony auto_stop audit entry in that case.
    const transitioned = await db
      .update(experimentsTable)
      .set({ status: "ended", endedAt: new Date() })
      .where(
        and(
          eq(experimentsTable.id, exp.id),
          eq(experimentsTable.status, "running"),
        ),
      )
      .returning({ id: experimentsTable.id });
    if (transitioned.length === 0) continue;
    opts.invalidateCache();
    await opts.audit({
      actorId: null,
      action: "experiment.auto_stop",
      entity: "experiment",
      entityId: exp.id,
      diff: { reason: decision.reason, from: "running", to: "ended" },
    });
    stopped += 1;
  }
  return { stopped };
}
