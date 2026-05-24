import { Router, type IRouter } from "express";
import { asc, eq, sql, desc } from "drizzle-orm";
import {
  db,
  experimentsTable,
  experimentVariantsTable,
  experimentAssignmentsTable,
  trafficEventsTable,
  type Experiment,
  type ExperimentVariant,
} from "@workspace/db";
import {
  CreateAdminExperimentBody,
  UpdateAdminExperimentBody,
  CreateAdminExperimentVariantBody,
  UpdateAdminExperimentVariantBody,
  AdminExperiment,
  ListAdminExperimentsResponse,
  GetAdminExperimentResultsResponse,
  OverrideMap,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { audit, buildAuditDiff } from "../lib/audit";
import { invalidateActiveExperimentsCache } from "./experiments";

const router: IRouter = Router();

// ----- Helpers -----------------------------------------------------------

function shapeAdminExperiment(
  exp: Experiment,
  variants: ExperimentVariant[],
) {
  return AdminExperiment.parse({
    id: exp.id,
    key: exp.key,
    name: exp.name,
    description: exp.description,
    pageKey: exp.pageKey,
    status: exp.status,
    trafficPercentage: exp.trafficPercentage,
    holdbackPercentage: exp.holdbackPercentage ?? 0,
    conversionPaths: exp.conversionPaths ?? [],
    autoStopAfterDays: exp.autoStopAfterDays,
    autoStopOnSignificance: exp.autoStopOnSignificance ?? false,
    minVisitorsForAutoStop: exp.minVisitorsForAutoStop ?? 1000,
    startedAt: exp.startedAt ? exp.startedAt.toISOString() : null,
    endedAt: exp.endedAt ? exp.endedAt.toISOString() : null,
    createdBy: exp.createdBy,
    createdAt: exp.createdAt.toISOString(),
    updatedAt: exp.updatedAt.toISOString(),
    variants: variants.map((v) => {
      // Defensive: a malformed `overrides` JSONB row mustn't break
      // the entire admin list/detail response. safeParse + empty
      // fallback so the UI loads and the bad row can be edited.
      const parsed = OverrideMap.safeParse(v.overrides ?? {});
      return {
        id: v.id,
        experimentId: v.experimentId,
        key: v.key,
        name: v.name,
        isControl: v.isControl,
        weight: v.weight,
        overrides: parsed.success ? parsed.data : {},
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      };
    }),
  });
}

async function loadExperimentOr404(
  id: string,
): Promise<{ exp: Experiment; variants: ExperimentVariant[] } | null> {
  const [exp] = await db
    .select()
    .from(experimentsTable)
    .where(eq(experimentsTable.id, id));
  if (!exp) return null;
  const variants = await db
    .select()
    .from(experimentVariantsTable)
    .where(eq(experimentVariantsTable.experimentId, id))
    .orderBy(asc(experimentVariantsTable.key));
  return { exp, variants };
}

function ensureValidVariantSet(variants: ExperimentVariant[]):
  | { ok: true }
  | { ok: false; error: string } {
  if (variants.length < 2) {
    return { ok: false, error: "Experiment requires at least 2 variants." };
  }
  const controls = variants.filter((v) => v.isControl);
  if (controls.length !== 1) {
    return {
      ok: false,
      error: "Experiment requires exactly one control variant.",
    };
  }
  const sum = variants.reduce((acc, v) => acc + v.weight, 0);
  if (sum !== 100) {
    return {
      ok: false,
      error: `Variant weights must sum to 100 (got ${sum}).`,
    };
  }
  return { ok: true };
}

// ----- List / Get --------------------------------------------------------

router.get("/admin/experiments", requireAdmin, async (_req, res): Promise<void> => {
  const exps = await db
    .select()
    .from(experimentsTable)
    .orderBy(desc(experimentsTable.createdAt));
  if (exps.length === 0) {
    res.json(ListAdminExperimentsResponse.parse({ experiments: [] }));
    return;
  }
  const variants = await db
    .select()
    .from(experimentVariantsTable)
    .orderBy(asc(experimentVariantsTable.key));
  const byExp = new Map<string, ExperimentVariant[]>();
  for (const v of variants) {
    const list = byExp.get(v.experimentId) ?? [];
    list.push(v);
    byExp.set(v.experimentId, list);
  }
  res.json(
    ListAdminExperimentsResponse.parse({
      experiments: exps.map((e) => shapeAdminExperiment(e, byExp.get(e.id) ?? [])),
    }),
  );
});

router.get(
  "/admin/experiments/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(shapeAdminExperiment(loaded.exp, loaded.variants));
  },
);

// ----- Create / Update ---------------------------------------------------

router.post(
  "/admin/experiments",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateAdminExperimentBody.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn(
        { zodError: parsed.error.flatten(), body: req.body },
        "experiment create body validation failed",
      );
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    try {
      const [created] = await db
        .insert(experimentsTable)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          pageKey: input.pageKey,
          trafficPercentage: input.trafficPercentage,
          holdbackPercentage: input.holdbackPercentage,
          conversionPaths: input.conversionPaths,
          status: "draft",
          createdBy: req.admin?.userId ?? null,
        })
        .returning();
      invalidateActiveExperimentsCache();
      await audit({
        actorId: req.admin?.userId ?? null,
        action: "experiment.create",
        entity: "experiment",
        entityId: created!.id,
        diff: { after: { key: created!.key, name: created!.name, pageKey: created!.pageKey } },
      });
      res.status(201).json(shapeAdminExperiment(created!, []));
    } catch (err) {
      // Postgres unique-violation = 23505. Most likely the `key` collision.
      // Drizzle wraps pg errors as DrizzleQueryError — code lives on .cause.
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({ error: "Experiment key already exists." });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/admin/experiments/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateAdminExperimentBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (loaded.exp.status === "ended") {
      res.status(409).json({ error: "Ended experiments are immutable." });
      return;
    }
    const updates: Partial<typeof experimentsTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) {
      updates.description = parsed.data.description;
    }
    if (parsed.data.trafficPercentage !== undefined) {
      updates.trafficPercentage = parsed.data.trafficPercentage;
    }
    if (parsed.data.holdbackPercentage !== undefined) {
      updates.holdbackPercentage = parsed.data.holdbackPercentage;
    }
    if (parsed.data.conversionPaths !== undefined) {
      updates.conversionPaths = parsed.data.conversionPaths;
    }
    if (parsed.data.autoStopAfterDays !== undefined) {
      updates.autoStopAfterDays = parsed.data.autoStopAfterDays;
    }
    if (parsed.data.autoStopOnSignificance !== undefined) {
      updates.autoStopOnSignificance = parsed.data.autoStopOnSignificance;
    }
    if (parsed.data.minVisitorsForAutoStop !== undefined) {
      updates.minVisitorsForAutoStop = parsed.data.minVisitorsForAutoStop;
    }
    const [updated] = await db
      .update(experimentsTable)
      .set(updates)
      .where(eq(experimentsTable.id, loaded.exp.id))
      .returning();
    const variants = await db
      .select()
      .from(experimentVariantsTable)
      .where(eq(experimentVariantsTable.experimentId, loaded.exp.id))
      .orderBy(asc(experimentVariantsTable.key));
    invalidateActiveExperimentsCache();
    const diff = buildAuditDiff(
      loaded.exp as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    if (diff) {
      await audit({
        actorId: req.admin?.userId ?? null,
        action: "experiment.update",
        entity: "experiment",
        entityId: loaded.exp.id,
        diff,
      });
    }
    res.json(shapeAdminExperiment(updated!, variants));
  },
);

// ----- Lifecycle: start / pause / end -----------------------------------

router.post(
  "/admin/experiments/:id/start",
  requireAdmin,
  async (req, res): Promise<void> => {
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (loaded.exp.status === "running") {
      res.json(shapeAdminExperiment(loaded.exp, loaded.variants));
      return;
    }
    if (loaded.exp.status === "ended") {
      res.status(409).json({ error: "Ended experiments cannot be restarted." });
      return;
    }
    const validity = ensureValidVariantSet(loaded.variants);
    if (!validity.ok) {
      res.status(400).json({ error: validity.error });
      return;
    }
    try {
      const [updated] = await db
        .update(experimentsTable)
        .set({
          status: "running",
          startedAt: loaded.exp.startedAt ?? new Date(),
        })
        .where(eq(experimentsTable.id, loaded.exp.id))
        .returning();
      invalidateActiveExperimentsCache();
      await audit({
        actorId: req.admin?.userId ?? null,
        action: "experiment.start",
        entity: "experiment",
        entityId: loaded.exp.id,
        diff: { from: loaded.exp.status, to: "running" },
      });
      res.json(shapeAdminExperiment(updated!, loaded.variants));
    } catch (err) {
      // Partial unique index — another experiment is already running for
      // this pageKey. Drizzle wraps pg errors as DrizzleQueryError, so the
      // Postgres error code lives on .cause, not on the top-level error.
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({
          error: `Another experiment is already running for page "${loaded.exp.pageKey}".`,
        });
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/admin/experiments/:id/pause",
  requireAdmin,
  async (req, res): Promise<void> => {
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (loaded.exp.status !== "running") {
      res
        .status(409)
        .json({ error: "Only running experiments can be paused." });
      return;
    }
    const [updated] = await db
      .update(experimentsTable)
      .set({ status: "paused" })
      .where(eq(experimentsTable.id, loaded.exp.id))
      .returning();
    invalidateActiveExperimentsCache();
    await audit({
      actorId: req.admin?.userId ?? null,
      action: "experiment.pause",
      entity: "experiment",
      entityId: loaded.exp.id,
      diff: { from: "running", to: "paused" },
    });
    res.json(shapeAdminExperiment(updated!, loaded.variants));
  },
);

router.post(
  "/admin/experiments/:id/end",
  requireAdmin,
  async (req, res): Promise<void> => {
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (loaded.exp.status === "ended") {
      res.json(shapeAdminExperiment(loaded.exp, loaded.variants));
      return;
    }
    if (loaded.exp.status === "draft") {
      res
        .status(409)
        .json({ error: "Drafts can be deleted, not ended." });
      return;
    }
    const [updated] = await db
      .update(experimentsTable)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(experimentsTable.id, loaded.exp.id))
      .returning();
    invalidateActiveExperimentsCache();
    await audit({
      actorId: req.admin?.userId ?? null,
      action: "experiment.end",
      entity: "experiment",
      entityId: loaded.exp.id,
      diff: { from: loaded.exp.status, to: "ended" },
    });
    res.json(shapeAdminExperiment(updated!, loaded.variants));
  },
);

router.post(
  "/admin/experiments/:id/duplicate",
  requireAdmin,
  async (req, res): Promise<void> => {
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const src = loaded.exp;
    // Build a unique key: append -copy, -copy-2, -copy-3, …
    let newKey = `${src.key}-copy`;
    let suffix = 1;
    while (true) {
      const existing = await db
        .select({ id: experimentsTable.id })
        .from(experimentsTable)
        .where(eq(experimentsTable.key, newKey))
        .limit(1);
      if (existing.length === 0) break;
      suffix += 1;
      newKey = `${src.key}-copy-${suffix}`;
    }
    const [created] = await db
      .insert(experimentsTable)
      .values({
        key: newKey,
        name: `${src.name} (Copy)`,
        description: src.description,
        pageKey: src.pageKey,
        trafficPercentage: src.trafficPercentage,
        holdbackPercentage: src.holdbackPercentage,
        conversionPaths: src.conversionPaths,
        autoStopAfterDays: src.autoStopAfterDays,
        autoStopOnSignificance: src.autoStopOnSignificance,
        minVisitorsForAutoStop: src.minVisitorsForAutoStop,
        status: "draft",
        createdBy: req.admin?.userId ?? null,
      })
      .returning();
    const copiedVariants = loaded.variants.length
      ? await db
          .insert(experimentVariantsTable)
          .values(
            loaded.variants.map((v) => ({
              experimentId: created!.id,
              key: v.key,
              name: v.name,
              isControl: v.isControl,
              weight: v.weight,
              overrides: v.overrides,
            })),
          )
          .returning()
      : [];
    invalidateActiveExperimentsCache();
    await audit({
      actorId: req.admin?.userId ?? null,
      action: "experiment.create",
      entity: "experiment",
      entityId: created!.id,
      diff: { after: { key: created!.key, name: created!.name, duplicatedFrom: src.id } },
    });
    res.status(201).json(shapeAdminExperiment(created!, copiedVariants));
  },
);

router.delete(
  "/admin/experiments/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (loaded.exp.status !== "draft") {
      res.status(409).json({
        error: "Only draft experiments can be deleted; end the experiment instead.",
      });
      return;
    }
    await db
      .delete(experimentsTable)
      .where(eq(experimentsTable.id, loaded.exp.id));
    invalidateActiveExperimentsCache();
    await audit({
      actorId: req.admin?.userId ?? null,
      action: "experiment.delete",
      entity: "experiment",
      entityId: loaded.exp.id,
      diff: { before: { key: loaded.exp.key, name: loaded.exp.name } },
    });
    res.status(204).end();
  },
);

// ----- Variants ----------------------------------------------------------

router.post(
  "/admin/experiments/:id/variants",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateAdminExperimentVariantBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Adding variants while running would invalidate live weight ratios.
    if (loaded.exp.status !== "draft" && loaded.exp.status !== "paused") {
      res
        .status(409)
        .json({ error: "Add variants only while draft or paused." });
      return;
    }
    try {
      const [created] = await db
        .insert(experimentVariantsTable)
        .values({
          experimentId: loaded.exp.id,
          key: parsed.data.key,
          name: parsed.data.name,
          isControl: parsed.data.isControl,
          weight: parsed.data.weight,
          overrides: parsed.data.overrides,
        })
        .returning();
      invalidateActiveExperimentsCache();
      await audit({
        actorId: req.admin?.userId ?? null,
        action: "experiment.variant.create",
        entity: "experiment_variant",
        entityId: created!.id,
        diff: {
          experimentId: loaded.exp.id,
          after: { key: created!.key, name: created!.name, weight: created!.weight, isControl: created!.isControl },
        },
      });
      res.status(201).json(created);
    } catch (err) {
      // Drizzle wraps pg errors as DrizzleQueryError — code lives on .cause.
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({ error: "Variant key already exists." });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/admin/variants/:variantId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateAdminExperimentVariantBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const [variant] = await db
      .select()
      .from(experimentVariantsTable)
      .where(eq(experimentVariantsTable.id, String(req.params.variantId)));
    if (!variant) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [exp] = await db
      .select()
      .from(experimentsTable)
      .where(eq(experimentsTable.id, variant.experimentId));
    if (!exp) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // weight + isControl are frozen once an experiment has ever been
    // started (running or paused) — only `draft` allows them to
    // change. Persisted assignments are first-seen-only (ON CONFLICT
    // DO NOTHING) and the client re-buckets deterministically, so
    // changing weights or which arm is "control" mid-experiment (even
    // while paused, before resume) would leave already-recorded
    // visitors attributed to a variant_key that no longer matches
    // what they'd see now.
    if (exp.status !== "draft") {
      const wantsImmutableChange =
        parsed.data.weight !== undefined ||
        parsed.data.isControl !== undefined;
      if (wantsImmutableChange) {
        res.status(409).json({
          error:
            "weight and isControl are frozen once the experiment has been started; only `name` and `overrides` may change after first start.",
        });
        return;
      }
    }
    if (exp.status === "ended") {
      res.status(409).json({ error: "Ended experiments are immutable." });
      return;
    }
    const updates: Partial<typeof experimentVariantsTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.isControl !== undefined) {
      updates.isControl = parsed.data.isControl;
    }
    if (parsed.data.weight !== undefined) updates.weight = parsed.data.weight;
    if (parsed.data.overrides !== undefined) {
      updates.overrides = parsed.data.overrides;
    }
    const [updated] = await db
      .update(experimentVariantsTable)
      .set(updates)
      .where(eq(experimentVariantsTable.id, variant.id))
      .returning();
    invalidateActiveExperimentsCache();
    const diff = buildAuditDiff(
      variant as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    if (diff) {
      await audit({
        actorId: req.admin?.userId ?? null,
        action: "experiment.variant.update",
        entity: "experiment_variant",
        entityId: variant.id,
        diff,
      });
    }
    res.json(updated);
  },
);

router.delete(
  "/admin/variants/:variantId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const [variant] = await db
      .select()
      .from(experimentVariantsTable)
      .where(eq(experimentVariantsTable.id, String(req.params.variantId)));
    if (!variant) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [exp] = await db
      .select()
      .from(experimentsTable)
      .where(eq(experimentsTable.id, variant.experimentId));
    if (exp && exp.status !== "draft") {
      res.status(409).json({
        error: "Variants can be deleted only while the experiment is a draft.",
      });
      return;
    }
    await db
      .delete(experimentVariantsTable)
      .where(eq(experimentVariantsTable.id, variant.id));
    invalidateActiveExperimentsCache();
    await audit({
      actorId: req.admin?.userId ?? null,
      action: "experiment.variant.delete",
      entity: "experiment_variant",
      entityId: variant.id,
      diff: { experimentId: variant.experimentId, before: { key: variant.key, name: variant.name } },
    });
    res.status(204).end();
  },
);

// ----- Results ----------------------------------------------------------

router.get(
  "/admin/experiments/:id/results",
  requireAdmin,
  async (req, res): Promise<void> => {
    const loaded = await loadExperimentOr404(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { exp, variants } = loaded;

    const conversions = exp.conversionPaths ?? [];

    // Build a per-conversion-path SQL match clause. Joined to
    // experiment_assignments below so the cohort matches the visitor
    // count: only naturally-bucketed visitors (forced_by IS NULL) and
    // events emitted at-or-after their assignedAt count.
    function matchClauseFor(cp: (typeof conversions)[number]) {
      // Use the alias "e" (from the LEFT JOIN below) rather than Drizzle table
      // column refs, which expand to "traffic_events"."col" — PostgreSQL rejects
      // bare table-name references inside FILTER clauses when the table is
      // accessed via an alias.
      if (cp.kind === "path") {
        return sql`e.event_name = 'conversion.path.visit'
          AND e.properties->>'path' = ${cp.value}`;
      }
      if (cp.kind === "booking") {
        return sql`e.event_name = 'conversion.booking.click'
          AND e.properties->>'eventId' = ${cp.value}`;
      }
      // cta / carousel — eventName equals the configured value (e.g.
      // "conversion.cta.get_started").
      return sql`e.event_name = ${cp.value}`;
    }

    // Single query: visitors per variant + overall + per-conversion
    // counts via Postgres FILTER aggregates. Replaces the previous
    // N+2 round-trips (one per conversion path + an overall + a
    // visitor count). All counts honor (forced_by IS NULL) and the
    // assignment row's variant_key as the source of truth, so
    // re-bucketing mid-flight can't smear a visitor across variants.
    const filterColumns = conversions.map(
      (cp, i) =>
        sql`COUNT(DISTINCT a.visitor_id) FILTER (WHERE ${matchClauseFor(
          cp,
        )})::int AS ${sql.raw(`conv_${i}`)}`,
    );
    const overallColumn =
      conversions.length > 0
        ? sql`, COUNT(DISTINCT a.visitor_id) FILTER (WHERE ${sql.join(
            conversions.map((cp) => sql`(${matchClauseFor(cp)})`),
            sql` OR `,
          )})::int AS overall_conv`
        : sql`, 0::int AS overall_conv`;
    const filterColumnList =
      filterColumns.length > 0
        ? sql`, ${sql.join(filterColumns, sql`, `)}`
        : sql``;

    type StatsRow = {
      variant_key: string;
      visitors: number;
      overall_conv: number;
      [k: string]: string | number;
    };
    const statsResult = await db.execute<StatsRow>(sql`
      SELECT a.variant_key,
             COUNT(DISTINCT a.visitor_id)::int AS visitors
             ${overallColumn}
             ${filterColumnList}
      FROM ${experimentAssignmentsTable} a
      LEFT JOIN ${trafficEventsTable} e
        ON e.properties->>'visitor_id' = a.visitor_id
        AND e.occurred_at >= a.assigned_at
      WHERE a.experiment_id = ${exp.id}
        AND a.forced_by IS NULL
      GROUP BY a.variant_key
    `);

    const visitorsByVariant = new Map<string, number>();
    const overallByVariant = new Map<string, number>();
    // conversionRows mirrors the previous shape so the downstream
    // shaping code keeps working unchanged.
    const conversionRows = conversions.map((cp) => ({
      cp,
      map: new Map<string, number>(),
    }));
    for (const r of statsResult.rows) {
      visitorsByVariant.set(r.variant_key, Number(r.visitors));
      overallByVariant.set(r.variant_key, Number(r.overall_conv));
      for (let i = 0; i < conversions.length; i++) {
        const value = r[`conv_${i}`];
        if (value !== undefined) {
          conversionRows[i]!.map.set(r.variant_key, Number(value));
        }
      }
    }

    const controlKey = variants.find((v) => v.isControl)?.key ?? null;
    const controlVisitors = controlKey
      ? visitorsByVariant.get(controlKey) ?? 0
      : 0;
    const controlConversions = controlKey
      ? overallByVariant.get(controlKey) ?? 0
      : 0;

    // Include the synthetic holdback bucket as a row in results when
    // the experiment configures one or any visitors landed there. It
    // doesn't have an entry in `variants`, but its assignments and
    // conversions are persisted under variant_key = "_holdback".
    const HOLDBACK_KEY = "_holdback";
    const reportableVariants: Array<
      Pick<ExperimentVariant, "key" | "name" | "isControl">
    > = [...variants];
    if (
      (exp.holdbackPercentage ?? 0) > 0 ||
      visitorsByVariant.has(HOLDBACK_KEY)
    ) {
      reportableVariants.push({
        key: HOLDBACK_KEY,
        name: "Holdback",
        isControl: false,
      });
    }

    const variantResults = reportableVariants.map((v) => {
      const visitors = visitorsByVariant.get(v.key) ?? 0;
      const conv = conversions.map((cp, i) => {
        const count = conversionRows[i]!.map.get(v.key) ?? 0;
        return {
          label: cp.label,
          kind: cp.kind,
          value: cp.value,
          count,
          rate: visitors > 0 ? count / visitors : 0,
        };
      });
      const overallCount = overallByVariant.get(v.key) ?? 0;
      const overall = {
        count: overallCount,
        rate: visitors > 0 ? overallCount / visitors : 0,
      };
      let significance:
        | { vsControl: number; pValue: number }
        | undefined;
      if (
        controlKey &&
        v.key !== controlKey &&
        controlVisitors > 0 &&
        visitors > 0
      ) {
        const p1 = overallCount / visitors;
        const p2 = controlConversions / controlVisitors;
        const pPool =
          (overallCount + controlConversions) / (visitors + controlVisitors);
        const denom = Math.sqrt(
          pPool * (1 - pPool) * (1 / visitors + 1 / controlVisitors),
        );
        const z = denom > 0 ? (p1 - p2) / denom : 0;
        // Two-tailed p-value via normal approximation.
        const pValue = 2 * (1 - normalCdf(Math.abs(z)));
        significance = { vsControl: z, pValue };
      }
      return {
        key: v.key,
        name: v.name,
        isControl: v.isControl,
        visitors,
        conversions: conv,
        overall,
        significance,
      };
    });

    res.json(
      GetAdminExperimentResultsResponse.parse({
        experimentId: exp.id,
        variants: variantResults,
      }),
    );
  },
);

// Abramowitz & Stegun 26.2.17 normal CDF approximation. Cheap and good
// enough for surfacing significance in the admin UI.
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

export default router;
