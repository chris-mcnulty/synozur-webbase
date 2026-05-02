import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

// #155 / launch readiness L4 — Content-Security-Policy violation reports
// posted by browsers to /api/csp/report while the CSP is rolled out in
// Report-Only mode. The dashboard at /admin/site-config/csp-violations
// (TODO) groups by (directive, blockedUri, documentPath) and surfaces the
// top offenders so directives can be tightened or third-party origins
// added before the CSP is flipped to enforcing.
//
// Schema: one row per (document path, violated directive, blocked URI)
// dedup key. `occurrences` and `lastSeenAt` are bumped on repeat reports
// so the table stays small even under heavy traffic.
export const cspViolationsTable = pgTable(
  "csp_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Path of the document that fired the violation (no query/fragment).
    documentPath: text("document_path").notNull(),
    // The CSP directive that was violated, e.g. "script-src", "img-src".
    violatedDirective: text("violated_directive").notNull(),
    // Original directive token from the report (may include source, e.g.
    // "script-src-elem"). Kept distinct from `violatedDirective` because
    // browsers occasionally report the more specific token.
    effectiveDirective: text("effective_directive"),
    // The resource URL the browser tried to load and blocked. Often
    // truncated by the browser to scheme/host for privacy.
    blockedUri: text("blocked_uri").notNull(),
    // The CSP header value that was active when the violation fired.
    // Stored so we can correlate reports with policy revisions.
    originalPolicy: text("original_policy"),
    // The disposition the browser reported the violation under: "report"
    // (Report-Only header) or "enforce" (Content-Security-Policy header).
    disposition: text("disposition"),
    // The HTTP status code the browser saw for the blocked resource, if
    // it got that far. 0 / null = blocked before the request was made.
    statusCode: integer("status_code"),
    // The user-agent string of the reporting browser. Trimmed to 256
    // chars at ingest time.
    userAgent: text("user_agent"),
    // The full report payload as posted, stored verbatim for debugging
    // edge cases the indexed columns don't capture.
    rawReport: jsonb("raw_report"),
    occurrences: integer("occurrences").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The dedup key for incoming reports.
    index("csp_violations_dedup_idx").on(
      t.documentPath,
      t.violatedDirective,
      t.blockedUri,
    ),
    // Hot path for the admin dashboard: filter by recent window, sort by
    // frequency.
    index("csp_violations_last_seen_idx").on(t.lastSeenAt),
  ],
);

export type CspViolation = typeof cspViolationsTable.$inferSelect;
export type InsertCspViolation = typeof cspViolationsTable.$inferInsert;
