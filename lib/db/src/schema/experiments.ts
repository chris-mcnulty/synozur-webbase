import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
  check,
  boolean,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { usersTable } from "./users";

// Status state machine: draft → running → paused ⇄ running → ended.
// Once `ended` is set the row is fully immutable — the admin API
// rejects every PATCH with 409 because changing copy on a finished
// experiment retroactively rewrites what historic visitors "saw"
// according to reporting joins. Use a follow-up experiment for any
// post-mortem editorial changes.
export const experimentStatusEnum = pgEnum("experiment_status", [
  "draft",
  "running",
  "paused",
  "ended",
]);

export const experimentsTable = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stable identifier used as the bucketing salt. Immutable post-create —
    // changing it would re-bucket every visitor and invalidate prior
    // assignments. Lower-snake-case by convention but not enforced.
    key: varchar("key", { length: 80 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    // Logical page scope (e.g. "home", "services", "solutions/ai-strategy").
    // Drives the partial unique index that enforces "one running experiment
    // per page".
    pageKey: varchar("page_key", { length: 80 }).notNull(),
    status: experimentStatusEnum("status").notNull().default("draft"),
    // Share of eligible visitors entered into the experiment. Visitors
    // above the cutoff are out-of-test (no assignment row, no reporting
    // impact, defaults render).
    trafficPercentage: integer("traffic_percentage").notNull().default(100),
    // Of in-test visitors, the share routed to a synthetic "_holdback"
    // bucket — they see defaults (no overrides applied) but their
    // assignment IS persisted so reporting can compare a held-back
    // baseline against the treated arms over time. 0 = no holdback.
    holdbackPercentage: integer("holdback_percentage").notNull().default(0),
    // Configured conversion targets — array of
    //   { kind: "cta" | "booking" | "path" | "carousel", value, label }.
    // `value` is an event id for cta/booking, a route prefix for path.
    conversionPaths: jsonb("conversion_paths")
      .$type<
        Array<{
          kind: "cta" | "booking" | "path" | "carousel";
          value: string;
          label: string;
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // Auto-stop policy. The scheduler ticks hourly; null disables the
    // policy. `autoStopAfterDays` ends the experiment N days after
    // start. `autoStopOnSignificance` ends it when the z-test against
    // control reaches p<0.05 AND every reportable variant has at least
    // `minVisitorsForAutoStop` distinct natural visitors (so a tiny
    // sample can't trip the policy).
    autoStopAfterDays: integer("auto_stop_after_days"),
    autoStopOnSignificance: boolean("auto_stop_on_significance")
      .notNull()
      .default(false),
    minVisitorsForAutoStop: integer("min_visitors_for_auto_stop")
      .notNull()
      .default(1000),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("experiments_key_uidx").on(t.key),
    // Partial unique index: only one running experiment per page at a time.
    // DB-level guarantee against races between concurrent /start calls.
    uniqueIndex("experiments_one_running_per_page_uidx")
      .on(t.pageKey)
      .where(sql`${t.status} = 'running'`),
    index("experiments_status_idx").on(t.status),
    index("experiments_page_key_idx").on(t.pageKey),
    check(
      "experiments_traffic_percentage_range",
      sql`${t.trafficPercentage} BETWEEN 0 AND 100`,
    ),
    check(
      "experiments_holdback_percentage_range",
      sql`${t.holdbackPercentage} BETWEEN 0 AND 100`,
    ),
  ],
);

export const experimentVariantsTable = pgTable(
  "experiment_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experimentsTable.id, { onDelete: "cascade" }),
    // Unique within an experiment. Used in URL force-overrides
    // (?_exp=<expKey>:<variantKey>) and as the bucketing target.
    key: varchar("key", { length: 40 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    isControl: boolean("is_control").notNull().default(false),
    // 0–100. Sum across an experiment's variants must equal 100. Validated
    // at the API layer rather than in the DB so editors can save a
    // partially-rebalanced draft.
    weight: integer("weight").notNull(),
    // Keyed override map. See lib/api-zod overrides schema for the
    // well-known keys (e.g. "home.hero.positioning.text").
    overrides: jsonb("overrides")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("experiment_variants_experiment_key_uidx").on(
      t.experimentId,
      t.key,
    ),
    index("experiment_variants_experiment_idx").on(t.experimentId),
    check(
      "experiment_variants_weight_range",
      sql`${t.weight} BETWEEN 0 AND 100`,
    ),
  ],
);

// First observed assignment per (experiment, visitor). Persisting first
// bucket keeps reporting honest if we later change the hash function or
// re-balance weights mid-flight. UNIQUE(experimentId, visitorId) makes the
// upsert idempotent on retry.
export const experimentAssignmentsTable = pgTable(
  "experiment_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experimentsTable.id, { onDelete: "cascade" }),
    visitorId: varchar("visitor_id", { length: 64 }).notNull(),
    variantKey: varchar("variant_key", { length: 40 }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // null = natural assignment; "url" = ?_exp=…; "admin_preview" = picker
    // in admin. Reporting filters out non-null values to avoid skew from
    // QA traffic.
    forcedBy: varchar("forced_by", { length: 20 }),
  },
  (t) => [
    uniqueIndex("experiment_assignments_experiment_visitor_uidx").on(
      t.experimentId,
      t.visitorId,
    ),
    index("experiment_assignments_experiment_variant_idx").on(
      t.experimentId,
      t.variantKey,
    ),
    index("experiment_assignments_assigned_at_idx").on(t.assignedAt),
  ],
);

export const experimentsRelations = relations(experimentsTable, ({ many }) => ({
  variants: many(experimentVariantsTable),
  assignments: many(experimentAssignmentsTable),
}));

export const experimentVariantsRelations = relations(
  experimentVariantsTable,
  ({ one }) => ({
    experiment: one(experimentsTable, {
      fields: [experimentVariantsTable.experimentId],
      references: [experimentsTable.id],
    }),
  }),
);

export const experimentAssignmentsRelations = relations(
  experimentAssignmentsTable,
  ({ one }) => ({
    experiment: one(experimentsTable, {
      fields: [experimentAssignmentsTable.experimentId],
      references: [experimentsTable.id],
    }),
  }),
);

export type Experiment = typeof experimentsTable.$inferSelect;
export type InsertExperiment = typeof experimentsTable.$inferInsert;
export type ExperimentVariant = typeof experimentVariantsTable.$inferSelect;
export type InsertExperimentVariant =
  typeof experimentVariantsTable.$inferInsert;
export type ExperimentAssignment =
  typeof experimentAssignmentsTable.$inferSelect;
export type InsertExperimentAssignment =
  typeof experimentAssignmentsTable.$inferInsert;
