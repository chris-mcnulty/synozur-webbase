import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// #142 Phase B — Real-user Core Web Vitals samples reported by visitors
// from the public site. The Express ingest route validates the payload
// shape; nothing here is admin-authenticated. Aggregations (percentiles
// per route + metric) are computed at read time on the admin
// `/admin/site-config/health` page so we don't have to maintain a
// secondary rollup table.
//
// Sampling strategy: web-vitals fires once per metric per page session,
// so the volume scales with pageviews. No additional client-side
// throttling is applied for this v0; if the table grows beyond comfort,
// add a daily cron that prunes samples older than 30 days.
export const cwvSamplesTable = pgTable(
  "cwv_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The visitor's pathname at sample time, as-reported by the client.
    // Stored verbatim for v0; aggregation queries can group by raw route.
    // A future iteration will normalize slugs to template paths.
    route: text("route").notNull(),
    // One of: LCP, INP, CLS, FCP, TTFB.
    metric: text("metric").notNull(),
    // Numeric metric value; all of CWV's metrics are non-negative
    // doubles (ms or unitless ratio for CLS).
    value: doublePrecision("value").notNull(),
    // web-vitals' three-bucket rating: good | needs-improvement | poor.
    rating: text("rating").notNull(),
    // Performance Navigation Timing type:
    // navigate | reload | back-forward | back-forward-cache | prerender | restore.
    navigationType: text("navigation_type"),
    // web-vitals' opaque metric id; preserved so we can de-dup if the
    // same metric is reported twice for the same page session.
    metricId: text("metric_id"),
    // Trimmed user-agent string (capped server-side to 256 chars) for
    // device-class diagnostics. No IP stored — the table is a
    // performance signal, not an audit log.
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Aggregation queries filter by recent window then group by route +
    // metric, so this composite index supports the dashboard's hot path.
    index("cwv_samples_route_metric_created_idx").on(
      t.route,
      t.metric,
      t.createdAt,
    ),
    index("cwv_samples_created_idx").on(t.createdAt),
  ],
);

export type CwvSample = typeof cwvSamplesTable.$inferSelect;
export type InsertCwvSample = typeof cwvSamplesTable.$inferInsert;
