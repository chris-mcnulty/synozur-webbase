import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// #142 Phase D — Publish-state quality blocks.
//
// A row here represents a *surfaced* signal that an artifact (or a
// site-wide concern) is below quality bar: a route's p75 LCP > 4s, a
// piece of media stuck on its placeholder alt-text, etc. The signals
// are recomputed by the `scanPublishBlocks()` library function, which
// also auto-resolves rows whose underlying metric has since improved.
//
// In this v0 we ship in **warn mode** — the publish mutation routes do
// not reject when a block exists. The block surface is editorial: each
// artifact's edit page shows its active blocks, and the
// `/admin/site-config/health` page lists the full set. A follow-up
// flips publish mutations to hard-reject on `severity = 'block'` rows
// once editors have had time to clear the inherited backlog.
//
// `artifact_id` is `text` (not `uuid`) so we can hold non-uuid keys for
// artifact kinds whose primary key isn't a uuid, plus a nullable
// `null` value for site-wide rows like alt-text coverage.
export const publishBlocksTable = pgTable(
  "publish_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactKind: text("artifact_kind").notNull(),
    artifactId: text("artifact_id"),
    // Stable rule identifier. `scanPublishBlocks()` uses
    // `(artifact_kind, artifact_id, source_rule)` as the dedup key
    // when an active row already exists.
    sourceRule: text("source_rule").notNull(),
    // 'warning' = warn-mode (v0 default). 'block' is reserved for the
    // hard-mode follow-up; the publish mutation routes will reject when
    // they see one. We accept any string here so a future rule can
    // define new severities without a migration.
    severity: text("severity").notNull().default("warning"),
    reason: text("reason").notNull(),
    // Diagnostic blob: the metric values that triggered the rule, the
    // window, the threshold. Rendered verbatim by the admin UI.
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // resolvedAt = null is the active-row predicate. The scanner sets
    // this when the underlying signal improves; an admin override
    // through DELETE /cms/publish-blocks/:id sets it with a note.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // Mandatory when an admin resolves manually. The scanner leaves
    // this null when it auto-resolves.
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    index("publish_blocks_active_idx").on(
      t.artifactKind,
      t.artifactId,
      t.resolvedAt,
    ),
    index("publish_blocks_rule_idx").on(t.sourceRule, t.resolvedAt),
  ],
);

export type PublishBlock = typeof publishBlocksTable.$inferSelect;
export type InsertPublishBlock = typeof publishBlocksTable.$inferInsert;
